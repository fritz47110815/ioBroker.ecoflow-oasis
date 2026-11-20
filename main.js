"use strict";
const utils = require("@iobroker/adapter-core");
const ModbusRTU = require("modbus-serial");

// Register offsets and datatypes taken from the upstream EcoFlow register table.
// This first adapter release deliberately starts with the core STREAM telemetry set.
// Additional entries can be added using the same schema.
const REGISTERS = [
  [0x0001,"system_phase","System phase","UINT16",""],
  [0x0003,"serial_number","Serial number","STRING",""],
  [0x000B,"firmware_version","Firmware version","UINT32",""],
  [0x0016,"inverter_active_power","Inverter total active power","INT16","W"],
  [0x0206,"system_consumption_power","System consumption power","FLOAT","W"],
  [0x0208,"system_grid_power","System grid power","FLOAT","W"],
  [0x020A,"system_pv_power","System PV power","FLOAT","W"],
  [0x020C,"system_battery_power","System battery power","FLOAT","W"],
  [0x020E,"system_soc","System SOC","UINT16","%"],
  [0x0227,"battery_capacity","Battery capacity","FLOAT","kWh"],
  [0x0229,"battery_available_charge_power","Battery available charge power","FLOAT","W"],
  [0x022B,"battery_available_discharge_power","Battery available discharge power","FLOAT","W"],
  [0x022E,"grid_current_l1","Grid current L1","FLOAT","A"],
  [0x0230,"grid_current_l2","Grid current L2","FLOAT","A"],
  [0x0232,"grid_current_l3","Grid current L3","FLOAT","A"],
  [0x0234,"grid_voltage_l1","Grid voltage L1","FLOAT","V"],
  [0x0236,"grid_voltage_l2","Grid voltage L2","FLOAT","V"],
  [0x0238,"grid_voltage_l3","Grid voltage L3","FLOAT","V"],
  [0x023D,"battery_voltage","Battery voltage","FLOAT","V"],
  [0x023F,"battery_current","Battery current","FLOAT","A"],
  [0x0241,"battery_temperature","Battery temperature","FLOAT","°C"],
  [0x0253,"pv1_voltage","PV1 voltage","FLOAT","V"],
  [0x0255,"pv1_current","PV1 current","FLOAT","A"],
  [0x0257,"pv2_voltage","PV2 voltage","FLOAT","V"],
  [0x0259,"pv2_current","PV2 current","FLOAT","A"],
  [0x025B,"pv3_voltage","PV3 voltage","FLOAT","V"],
  [0x025D,"pv3_current","PV3 current","FLOAT","A"],
  [0x2400,"grid_status","Grid status","UINT16",""],
  [0x2401,"bypass_ac1_power","Bypass AC1 power","FLOAT","W"],
  [0x2404,"bypass_ac2_power","Bypass AC2 power","FLOAT","W"],
  [0x2407,"bypass_ac3_power","Bypass AC3 power","FLOAT","W"],
  [0x0870,"grid_import_energy_total","Grid import energy total","FLOAT","kWh"],
  [0x0872,"grid_import_energy_today","Grid import energy today","FLOAT","kWh"],
  [0x0880,"grid_export_energy_total","Grid export energy total","FLOAT","kWh"],
  [0x0882,"grid_export_energy_today","Grid export energy today","FLOAT","kWh"],
  [0x08D0,"solar_energy_total","Solar energy total","FLOAT","kWh"],
  [0x0800,"system_fault_count","System fault count","UINT16",""]
];
const WORDS = {UINT16:1,INT16:1,UINT32:2,INT32:2,FLOAT:2,STRING:8};

class EcoflowOasis extends utils.Adapter {
  constructor(options = {}) {
    super({...options,name:"ecoflow-oasis"});
    this.client = new ModbusRTU();
    this.connected = false;
    this.pollTimer = null;
    this.heartbeatTimer = null;
    this.pollBusy = false;
    this.on("ready", () => this.start());
    this.on("stateChange", (id,state) => this.onStateChange(id,state));
    this.on("unload", cb => this.stop(cb));
  }

  async start() {
    const n = this.config;
    if (!n.host) {
      this.log.error("Bitte eine EcoFlow-IP-Adresse in der Adapterkonfiguration eintragen.");
      return;
    }
    this.base = Number.isInteger(n.addressOffset) ? n.addressOffset : 40001;
    try {
      await this.client.connectTCP(n.host,{port:n.port || 502});
      this.client.setID(n.unitId || 1);
      this.client.setTimeout(4000);
      this.connected = true;
      this.log.info(`Verbunden mit EcoFlow ${n.host}:${n.port || 502}`);
      await this.createObjects();
      await this.poll();
      this.pollTimer = setInterval(() => this.poll(), Math.max(2, n.pollInterval || 5)*1000);
      if (n.heartbeat !== false) {
        this.heartbeatTimer = setInterval(() => this.writeRegister(0x025F,"UINT16",1).catch(e => this.log.debug(`Heartbeat: ${e.message}`)),20000);
      }
    } catch (e) {
      this.log.error(`Modbus-Verbindung fehlgeschlagen: ${e.message}`);
      this.scheduleReconnect();
    }
  }

  async createObjects() {
    await this.setObjectNotExistsAsync("info",{type:"channel",common:{name:"Verbindungsstatus"},native:{}});
    await this.setObjectNotExistsAsync("info.connection",{type:"state",common:{name:"Verbindung",type:"boolean",role:"indicator.connected",read:true,write:false},native:{}});
    for (const [offset,id,name,dtype,unit] of REGISTERS) {
      await this.setObjectNotExistsAsync(id,{
        type:"state",
        common:{name, type:dtype==="STRING"?"string":"number", role:unit==="W"?"value.power":unit==="%"?"value.battery":unit==="kWh"?"value.energy":"value",
          unit,read:true,write:false},
        native:{offset,dtype}
      });
    }
    // Writable setpoints are intentionally exposed separately and only for known control points.
    const controls = [
      [0x0217,"backup_reserve_ratio","Backup reserve ratio",0,100,"%"],
      [0x021C,"led_brightness","LED brightness",0,100,"%"],
      [0x023C,"feed_in_limit","Feed-in limit",1,100,"%"]
    ];
    for (const [offset,id,name,min,max,unit] of controls) {
      await this.setObjectNotExistsAsync(`control.${id}`,{type:"state",common:{name,type:"number",role:"level",unit,min,max,read:true,write:true},native:{offset,dtype:"UINT16"}});
    }
    await this.setStateAsync("info.connection",true,true);
  }

  async readRegister(offset,dtype) {
    const count = WORDS[dtype] || 1;
    const r = await this.client.readHoldingRegisters(this.base + offset,count);
    const w = r.data;
    if (dtype==="UINT16") return w[0];
    if (dtype==="INT16") return w[0] > 32767 ? w[0]-65536 : w[0];
    const b = Buffer.alloc(4); b.writeUInt16BE(w[0],0); b.writeUInt16BE(w[1],2);
    if (dtype==="UINT32") return b.readUInt32BE(0);
    if (dtype==="INT32") return b.readInt32BE(0);
    if (dtype==="FLOAT") return Number(b.readFloatBE(0).toFixed(4));
    if (dtype==="STRING") {
      const bytes=Buffer.alloc(count*2); w.forEach((v,i)=>bytes.writeUInt16BE(v,i*2));
      return bytes.toString("ascii").replace(/\0+$/g,"");
    }
    return null;
  }

  async writeRegister(offset,dtype,value) {
    const words=[];
    if (dtype==="UINT16") words.push(Number(value)&0xffff);
    else if (dtype==="UINT32" || dtype==="INT32" || dtype==="FLOAT") {
      const b=Buffer.alloc(4);
      if (dtype==="FLOAT") b.writeFloatBE(Number(value));
      else if (dtype==="INT32") b.writeInt32BE(Number(value));
      else b.writeUInt32BE(Number(value));
      words.push(b.readUInt16BE(0),b.readUInt16BE(2));
    } else throw new Error(`Nicht unterstützter Schreibtyp ${dtype}`);
    if (words.length===1) await this.client.writeRegister(this.base+offset,words[0]);
    else await this.client.writeRegisters(this.base+offset,words);
  }

  async poll() {
    if (this.pollBusy || !this.connected) return;
    this.pollBusy=true;
    try {
      for (const [offset,id,,dtype] of REGISTERS) {
        try {
          const value=await this.readRegister(offset,dtype);
          if (value !== null && !(typeof value==="number" && !Number.isFinite(value))) {
            await this.setStateAsync(id,{val:value,ack:true});
          }
        } catch (e) {
          this.log.debug(`Lesefehler ${id} (0x${offset.toString(16)}): ${e.message}`);
        }
      }
      await this.setStateAsync("info.connection",true,true);
    } catch(e) {
      this.log.warn(`Polling-Fehler: ${e.message}`);
      await this.setStateAsync("info.connection",false,true);
      this.connected=false;
      this.scheduleReconnect();
    } finally { this.pollBusy=false; }
  }

  async onStateChange(id,state) {
    if (!id || !state || state.ack || !id.startsWith(`${this.namespace}.control.`)) return;
    const key=id.split(".").pop();
    const map={backup_reserve_ratio:0x0217,led_brightness:0x021C,feed_in_limit:0x023C};
    const offset=map[key];
    if (!offset) return;
    const value=Number(state.val);
    const limits={backup_reserve_ratio:[0,100],led_brightness:[0,100],feed_in_limit:[1,100]}[key];
    if (!Number.isFinite(value) || value<limits[0] || value>limits[1] || !Number.isInteger(value)) {
      this.log.warn(`Ungültiger Wert für ${key}: ${state.val}`);
      return;
    }
    try {
      await this.writeRegister(offset,"UINT16",value);
      await this.setStateAsync(id,{val:value,ack:true});
      this.log.info(`${key} auf ${value} gesetzt`);
    } catch(e) { this.log.error(`Schreiben von ${key} fehlgeschlagen: ${e.message}`); }
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    this.reconnectTimer=setTimeout(async()=>{
      this.reconnectTimer=null;
      try {
        await this.client.connectTCP(this.config.host,{port:this.config.port||502});
        this.client.setID(this.config.unitId||1);
        this.client.setTimeout(4000);
        this.connected=true;
        await this.setStateAsync("info.connection",true,true);
        this.log.info("Modbus-Verbindung wiederhergestellt");
        await this.poll();
      } catch(e) { this.log.warn(`Reconnect fehlgeschlagen: ${e.message}`); this.scheduleReconnect(); }
    },5000);
  }

  stop(callback) {
    if (this.pollTimer) clearInterval(this.pollTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    try { this.client.close(()=>{}); } catch {}
    callback();
  }
}
if (module.parent) module.exports = options => new EcoflowOasis(options);
else new EcoflowOasis();
