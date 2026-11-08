import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import {
  getOverkizConnection,
  findAtlanticHeater,
  getDeviceStates,
  normalizeStates,
  executeHeaterCommand,
} from "@/lib/overkiz";
import { getProviderToken } from "@/lib/provider-auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function allowed(request: Request) {
  const secret = process.env.VOLTOS_BRIDGE_SECRET ?? "";
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (secret.length < 32 || supplied.length !== secret.length) return false;
  const a=createHash("sha256").update(supplied).digest();
  const b=createHash("sha256").update(secret).digest();
  return timingSafeEqual(a,b);
}
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };

async function connected() {
  const accessToken=await getProviderToken();
  const {cookie,setup}=await getOverkizConnection(accessToken);
  const heater=findAtlanticHeater(setup);
  const gateways=Array.isArray(setup.gateways)?setup.gateways as Record<string,unknown>[]:[];
  const gatewayOnline=gateways.some(g=>g.alive===true&&String(g.connectivity??"").toUpperCase()!=="DISCONNECTED");
  const states=normalizeStates(await getDeviceStates(cookie,String(heater.deviceURL)));
  const devices=Array.isArray(setup.devices)?setup.devices as Record<string,unknown>[]:[];
  const sensor=devices.find(d=>String(d.controllableName??"").includes("TemperatureInCelcius"));
  let roomTemperature:number|null=null;
  if(sensor&&typeof sensor.deviceURL==="string"){
    try {
      const sensorStates=normalizeStates(await getDeviceStates(cookie,sensor.deviceURL));
      const t=Number(sensorStates.Temperature);
      if(Number.isFinite(t)&&t>=-30&&t<=60)roomTemperature=t;
    }catch{}
  }
  return {cookie,heater,states,gatewayOnline,roomTemperature};
}
function numberInRange(value:unknown,min:number,max:number) {
  const n=typeof value==="number"?value:NaN;
  return Number.isFinite(n)&&n>=min&&n<=max?n:null;
}
export async function GET(request:Request){
 if(!allowed(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
 try{
  const {heater,states,gatewayOnline,roomTemperature}=await connected();
  const target=numberInRange(states.TargetTemperature,7,30);
  const mode=typeof states.OperatingMode==="string"?states.OperatingMode:null;
  const power=states.OnOff==="on"?true:states.OnOff==="off"?false:null;
  const availableCommands=(heater.definition?.commands??[]).map(c=>c.commandName);
  return NextResponse.json({
    connected:true, deviceOnline:gatewayOnline&&heater.available!==false,
    name:heater.label??"Atlantic Altis Eco Boost",roomTemperature,targetTemperature:target,
    power,mode,commands:availableCommands,measuredAt:new Date().toISOString(),
    source:"atlantic-cozytouch",gatewayOnline
  },{headers});
 }catch(error){
  const code=error instanceof Error?error.message:"UNKNOWN";
  return NextResponse.json({connected:false,error:"Не вдалося отримати стан Atlantic",code},{status:503,headers});
 }
}
export async function POST(request:Request){
 if(!allowed(request))return NextResponse.json({error:"Unauthorized"},{status:401,headers});
 try{
  const body=await request.json() as {action?:unknown;value?:unknown};
  let command:string;let parameters:unknown[]=[];
  if(body.action==="power"&&typeof body.value==="boolean")command=body.value?"on":"off";
  else if(body.action==="temperature"){
   const v=numberInRange(body.value,7,30);
   if(v===null||Math.round(v*2)!==v*2)return NextResponse.json({error:"Температура: 7–30°C, крок 0,5°C"},{status:400,headers});
   command="setTargetTemperature";parameters=[v];
  }else if(body.action==="mode"&&typeof body.value==="string"&&
   ["normal","eco","antifreeze","frostprotection","auto","manual","prog","boost","away","off","on"].includes(body.value)){
   command="setOperatingMode";parameters=[body.value];
  }else return NextResponse.json({error:"Недозволена команда"},{status:400,headers});
  const {cookie,heater,gatewayOnline}=await connected();
  if(!gatewayOnline||heater.available===false)return NextResponse.json({error:"Шлюз або конвектор офлайн"},{status:409,headers});
  await executeHeaterCommand(cookie,heater,command,parameters);
  // The provider accepts jobs asynchronously: do not claim physical state changed.
  return NextResponse.json({accepted:true,confirmed:false,command,description:"Cozytouch прийняв команду. Фізичний стан потрібно перевірити повторним зчитуванням."},{headers});
 }catch(error){
  const code=error instanceof Error?error.message:"UNKNOWN";
  return NextResponse.json({error:"Не вдалося надіслати команду Atlantic",code},{status:502,headers});
 }
}
