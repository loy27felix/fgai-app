// Close only this gateway's connections, including SSE and upgraded sockets.
// The deployer checks that FG generation/Agent tasks are idle before signaling.
export function createGatewayShutdown(servers,{shutdownStreams,closeDependencies,graceMs=5000}){
 const sockets=new Set();
 for(const server of servers)server.on('connection',socket=>{
  sockets.add(socket);socket.once('close',()=>sockets.delete(socket));
 });
 let pending;
 return ()=>pending??=(async()=>{
  const deadline=setTimeout(()=>{for(const socket of sockets)socket.destroy();},graceMs);
  deadline.unref();
  try{
   await Promise.all([shutdownStreams(),...servers.map(server=>new Promise((resolve,reject)=>server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve())))]);
   await closeDependencies();
  }finally{clearTimeout(deadline);}
 })();
}
