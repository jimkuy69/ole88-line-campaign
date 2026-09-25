import 'dotenv/config';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { createDatabase } from './client.js';
import { AdminAuthService } from '../modules/admin/admin-auth-service.js';

function hidden(prompt:string):Promise<string>{
  return new Promise((resolve,reject)=>{
    if(!stdin.isTTY||typeof stdin.setRawMode!=='function'){reject(new Error('Run admin:create from an interactive terminal so passwords are not echoed.'));return;}
    stdout.write(prompt);stdin.setRawMode(true);stdin.resume();
    let value='';
    const done=(err?:Error)=>{stdin.setRawMode(false);stdin.pause();stdin.off('data',onData);stdout.write('\n');if(err)reject(err);else resolve(value);};
    const onData=(buffer:Buffer)=>{for(const char of buffer.toString('utf8')){
      if(char==='\u0003'){done(new Error('Cancelled.'));return;}
      if(char==='\r'||char==='\n'){done();return;}
      if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else value+=char;
    }};
    stdin.on('data',onData);
  });
}

async function main(){
  if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL is required.');
  const io=createInterface({input:stdin,output:stdout});
  const username=await io.question('New admin username: ');io.close();
  if(!/^[A-Za-z0-9_.@-]{3,120}$/.test(username.trim()))throw new Error('Username must be 3 to 120 letters, numbers, dots, underscores, @ signs or hyphens.');
  const password=await hidden('Password (12+ chars): ');
  const confirmation=await hidden('Confirm password: ');
  if(password!==confirmation)throw new Error('Passwords do not match.');
  const {db,pool}=createDatabase(process.env.DATABASE_URL);
  try{const admin=await new AdminAuthService(db).createFirstAdmin(username,password);stdout.write(`Created initial admin ${admin.username}.\n`);}
  finally{await pool.end();}
}
main().catch((error:unknown)=>{stderr(error instanceof Error?error.message:'Admin bootstrap failed');process.exitCode=1;});
function stderr(message:string){process.stderr.write(`${message}\n`);}
