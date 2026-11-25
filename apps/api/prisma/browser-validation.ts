import 'dotenv/config';
import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import argon2 from 'argon2';
const url = new URL(process.env.DATABASE_URL!);
if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/aspireedge_lms') throw new Error('Local source required.');
const root=resolve('../..'), database='aspireedge_browser_validation';
const docker=(args:string[],input?:Buffer)=>execFileSync('docker',['compose','exec','-T','postgres',...args],{cwd:root,input,maxBuffer:100*1024*1024,stdio:['pipe','pipe','pipe']});
let created=false,closing=false;const children:ChildProcess[]=[];
async function cleanup(){if(closing)return;closing=true;for(const child of children)child.kill('SIGTERM');await Promise.all(children.map(child=>child.exitCode!==null?Promise.resolve():new Promise(resolve=>child.once('exit',resolve))));if(created)docker(['sh','-c','dropdb -U "$POSTGRES_USER" "$1"','sh',database]);}
try {
  docker(['sh','-c','createdb -U "$POSTGRES_USER" "$1"','sh',database]);created=true;
  docker(['sh','-c','pg_restore -U "$POSTGRES_USER" -d "$1" --exit-on-error','sh',database],docker(['sh','-c','pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc']));
  url.pathname=`/${database}`;process.env.DATABASE_URL=url.toString();
  const env={...process.env,PORT:'4002',WEB_ORIGIN:'http://127.0.0.1:5175',API_ORIGIN:'http://127.0.0.1:4002',VITE_API_URL:'http://127.0.0.1:4002/api/v1'};
  execFileSync(resolve('../../node_modules/.bin/prisma'),['migrate','deploy'],{env,stdio:'pipe'});
  const {PrismaClient}=await import('@prisma/client');const db=new PrismaClient();
  const passwordHash=await argon2.hash('browser-fixture-only-2026');
  await db.user.create({data:{email:'browser-admin@example.invalid',name:'Browser Test Administrator',platformRole:'SUPER_ADMIN',passwordHash}});
  const learner=await db.user.create({data:{email:'browser-student@example.invalid',name:'Browser Test Learner',passwordHash,directStudent:{create:{studentCode:'STUBROWSER2026'}}}});
  const course=await db.course.create({data:{title:'Browser validation course',pricePaise:10000,status:'PUBLISHED',modules:{create:{title:'Introduction',lessons:{create:{title:'Welcome lesson',content:'Complete this sample lesson to validate progress.'}}}}}});
  await db.directEnrollment.create({data:{userId:learner.id,courseId:course.id,source:'COMPLIMENTARY'}});
  await db.quiz.create({data:{courseId:course.id,title:'Browser validation quiz',published:true,questions:[{id:randomUUID(),prompt:'Which option completes this test?',kind:'MCQ',choices:['Correct answer','Incorrect answer'],correctOptions:[0]}]}});
  await db.assignment.create({data:{courseId:course.id,title:'Browser validation assignment',instructions:'Submit a short test response.',published:true}});
  await db.user.create({data:{email:'browser-buyer@example.invalid',name:'Browser Test Buyer',passwordHash,directStudent:{create:{studentCode:'STUBUYER2026'}}}});
  await db.course.create({data:{title:'Browser bundle companion',pricePaise:20000,status:'PUBLISHED'}});
  await db.$disconnect();
  children.push(spawn(resolve('../../node_modules/.bin/tsx'),['src/server.ts'],{env,stdio:['ignore','pipe','pipe']}));
  children.push(spawn(resolve('../../node_modules/.bin/vite'),['--host','127.0.0.1','--port','5175','--strictPort'],{cwd:resolve('../web'),env,stdio:['ignore','pipe','pipe']}));
  for(const child of children)child.once('error',()=>{console.error('Validation server failed.');void cleanup();});
  console.log('Disposable browser validation ready at http://127.0.0.1:5175. Stop this process to remove its database.');
  process.on('SIGINT',()=>{void cleanup().then(()=>process.exit());});process.on('SIGTERM',()=>{void cleanup().then(()=>process.exit());});
} catch {await cleanup();console.error('Browser setup failed. Existing databases were not overwritten.');process.exitCode=1;}
