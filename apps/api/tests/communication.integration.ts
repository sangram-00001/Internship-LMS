import 'dotenv/config';
import assert from 'node:assert/strict';
import request from 'supertest';
import argon2 from 'argon2';
import {mkdtemp,readdir,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
const url=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/aspireedge_accounts_validation')throw new Error('Disposable validation database required.');
const {app}=await import('../src/app.js');const {prisma}=await import('../src/lib/prisma.js');
const {notifyStudent,dispatchAnnouncements,queueAssignmentReminders,deliverLocalMail}=await import('../src/lib/notifications.js');
const stamp=Date.now(),password='communication-fixture-only';let checks=0;const folder=await mkdtemp(join(tmpdir(),'aspireedge-communication-'));process.env.LOCAL_MAIL_PATH=folder;
function status(r:request.Response,n:number){assert.equal(r.status,n);checks++;return r;}
function cookie(r:request.Response){return (r.headers['set-cookie'] as unknown as string[]).map(c=>c.split(';')[0]).join('; ');}
try{
 const admin=await prisma.user.create({data:{email:`messages-admin-${stamp}@example.invalid`,name:'Support admin',platformRole:'SUPER_ADMIN',passwordHash:await argon2.hash(password)}});
 const adminLogin=status(await request(app).post('/api/v1/auth/login').send({email:admin.email,password}),200);
 const a=status(await request(app).post('/api/v1/auth/register').send({name:'Support learner A',email:`messages-a-${stamp}@example.invalid`,password,confirmPassword:password}),201);
 const b=status(await request(app).post('/api/v1/auth/register').send({name:'Support learner B',email:`messages-b-${stamp}@example.invalid`,password,confirmPassword:password}),201);
 function call(session:request.Response,method:'post'|'get',path:string,body?:unknown){const req=request(app)[method](`/api/v1${path}`).set('Cookie',cookie(session)).set('X-CSRF-Token',session.body.data.csrfToken);return body===undefined?req:req.send(body);}
 const ticket=status(await call(a,'post','/communication/tickets',{subject:'Course question',body:'Please help with the test course.'}),201).body.data;
 status(await call(b,'get',`/communication/tickets/${ticket.id}`),404);
 status(await call(b,'post',`/communication/tickets/${ticket.id}/replies`,{body:'Unauthorized reply'}),404);
 status(await call(a,'post',`/communication/tickets/${ticket.id}/replies`,{body:'Self resolve',resolve:true}),403);
 status(await call(adminLogin,'post',`/communication/tickets/${ticket.id}/replies`,{body:'Here is the test response.',resolve:true}),201);
 let thread=status(await call(a,'get',`/communication/tickets/${ticket.id}`),200).body.data;assert.equal(thread.status,'RESOLVED');assert.equal(thread.messages.length,2);
 status(await call(a,'post',`/communication/tickets/${ticket.id}/replies`,{body:'A follow-up question.'}),201);
 thread=status(await call(adminLogin,'get',`/communication/tickets/${ticket.id}`),200).body.data;assert.equal(thread.status,'OPEN');assert.equal(thread.messages.length,3);
 const notices=status(await call(a,'get','/communication/notifications'),200).body.data;assert.ok(notices.unread>=1);const notice=notices.notifications[0];
 status(await call(b,'post',`/communication/notifications/${notice.id}/read`),404);
 status(await call(a,'post',`/communication/notifications/${notice.id}/read`),200);
 const course=await prisma.course.create({data:{title:'Announcement course',status:'PUBLISHED'}});
 await prisma.directEnrollment.create({data:{courseId:course.id,userId:a.body.data.user.id,source:'COMPLIMENTARY'}});
 const announcement=status(await call(adminLogin,'post','/communication/admin/announcements',{courseId:course.id,title:'Course update',body:'A course update for active learners.'}),201).body.data;
 status(await call(a,'post','/communication/admin/announcements',{courseId:null,title:'Unauthorized',body:'Not allowed'}),403);
 await dispatchAnnouncements(prisma);await dispatchAnnouncements(prisma);
 assert.equal(await prisma.notification.count({where:{eventKey:{startsWith:`announcement:${announcement.id}:`}}}),1);
 assert.equal(await prisma.notification.count({where:{userId:b.body.data.user.id,eventKey:{startsWith:`announcement:${announcement.id}:`}}}),0);
 const assignment=await prisma.assignment.create({data:{courseId:course.id,title:'Due assignment',instructions:'Test reminder',published:true,dueAt:new Date(Date.now()+3600000)}});
 await queueAssignmentReminders(prisma);await queueAssignmentReminders(prisma);
 assert.equal(await prisma.notification.count({where:{eventKey:{startsWith:`assignment-due:${assignment.id}:`}}}),1);
 const event={userId:a.body.data.user.id,eventKey:`dedupe:${stamp}`,title:'Idempotent update',body:'One update only',path:'/student'};
 await prisma.$transaction(tx=>notifyStudent(tx,event));await prisma.$transaction(tx=>notifyStudent(tx,event));assert.equal(await prisma.notification.count({where:{eventKey:event.eventKey}}),1);
 const ready=await prisma.emailJob.count({where:{deliveredAt:null,attempts:{lt:5}}});
 const delivery=await Promise.all([deliverLocalMail(prisma),deliverLocalMail(prisma)]);assert.equal(delivery.reduce((a,b)=>a+b,0),ready);
 const files=await readdir(folder);assert.equal(files.filter(f=>f.endsWith('.txt')).length,ready);assert.equal(files.filter(f=>f.endsWith('.tmp')).length,0);
 assert.equal(await prisma.emailJob.count({where:{deliveredAt:{not:null},body:{not:'[delivered to local mailbox]'}}}),0);
 const failed=await prisma.emailJob.create({data:{recipient:'fixture@example.invalid',subject:'Retry fixture',body:'Test message',attempts:5,lockedAt:new Date(Date.now()-6*60000),lockId:'crashed-final-attempt'}});
 status(await call(a,'post',`/communication/admin/jobs/${failed.id}/retry`),403);
 status(await call(adminLogin,'post',`/communication/admin/jobs/${failed.id}/retry`),200);
 assert.equal((await prisma.emailJob.findUniqueOrThrow({where:{id:failed.id}})).attempts,0);
 const jobStatus=status(await call(adminLogin,'get','/communication/admin/jobs'),200).body.data;assert.equal(jobStatus.deliveryMode,'LOCAL_ONLY');assert.equal(jobStatus.failed.some((j:{id:string})=>j.id===failed.id),false);
 // A filesystem failure keeps the body and schedules a bounded retry instead of losing the job.
 process.env.LOCAL_MAIL_PATH='/dev/null/not-a-directory';await assert.rejects(()=>deliverLocalMail(prisma));process.env.LOCAL_MAIL_PATH=folder;
 assert.equal((await prisma.emailJob.findUniqueOrThrow({where:{id:failed.id}})).deliveredAt,null);
 await deliverLocalMail(prisma);assert.ok((await prisma.emailJob.findUniqueOrThrow({where:{id:failed.id}})).deliveredAt);
 console.log(`PASS: ${checks} communication HTTP assertions plus ticket isolation, announcement/reminder deduplication, concurrent worker claims, private delivery and audit checks.`);
}finally{await prisma.$disconnect();await rm(folder,{recursive:true,force:true});}
