import 'dotenv/config';
import assert from 'node:assert/strict';
import request from 'supertest';
import argon2 from 'argon2';
const url=new URL(process.env.DATABASE_URL!);
if(!['localhost','127.0.0.1'].includes(url.hostname)||url.pathname!=='/aspireedge_accounts_validation')throw new Error('Disposable validation database required.');
const {app}=await import('../src/app.js');const {prisma}=await import('../src/lib/prisma.js');
const stamp=Date.now(),password='commerce-fixture-only-password';let checks=0;
function status(r:request.Response,n:number){assert.equal(r.status,n);checks++;return r;}
function cookie(r:request.Response){return (r.headers['set-cookie'] as unknown as string[]).map(c=>c.split(';')[0]).join('; ');}
try{
 const admin=await prisma.user.create({data:{email:`commerce-admin-${stamp}@example.invalid`,name:'Commerce admin',platformRole:'SUPER_ADMIN',passwordHash:await argon2.hash(password)}});
 const adminLogin=status(await request(app).post('/api/v1/auth/login').send({email:admin.email,password}),200);
 const a=status(await request(app).post('/api/v1/auth/register').send({name:'Commerce learner A',email:`commerce-a-${stamp}@example.invalid`,password,confirmPassword:password}),201);
 const b=status(await request(app).post('/api/v1/auth/register').send({name:'Commerce learner B',email:`commerce-b-${stamp}@example.invalid`,password,confirmPassword:password}),201);
 function call(session:request.Response,method:'post'|'put'|'patch'|'get',path:string,body?:unknown){const req=request(app)[method](`/api/v1${path}`).set('Cookie',cookie(session)).set('X-CSRF-Token',session.body.data.csrfToken);return body===undefined?req:req.send(body);}
 const first=await prisma.course.create({data:{title:'Commerce fixture one',pricePaise:4000,status:'PUBLISHED'}}),second=await prisma.course.create({data:{title:'Commerce fixture two',pricePaise:6000,status:'PUBLISHED'}});
 const bundle=status(await call(adminLogin,'post','/commerce/admin/bundles',{title:'Commerce test bundle',description:'Fixture bundle',pricePaise:8000,courseIds:[first.id,second.id],published:true}),201).body.data;
 status(await call(a,'post','/commerce/admin/bundles',{title:'Unauthorized',description:'',pricePaise:0,courseIds:[first.id,second.id],published:true}),403);
 const coupon=status(await call(adminLogin,'post','/commerce/admin/coupons',{code:`SAVE${stamp}`,kind:'PERCENT',value:25,courseId:null,expiresAt:null,usageLimit:1}),201).body.data;
 const selected={bundleId:bundle.id,couponCode:coupon.code};
 const quote=status(await call(a,'post','/commerce/student/quote',selected),200).body.data;assert.equal(quote.totalPaise,6000);
 status(await call(a,'post','/commerce/student/orders',{...selected,paymentMethod:'UPI',expectedTotalPaise:1}),409);
 status(await call(a,'post','/commerce/student/orders',{...selected,paymentMethod:'UPI',amountPaise:1}),422);
 const race=await Promise.all([call(a,'post','/commerce/student/orders',{...selected,paymentMethod:'UPI',expectedTotalPaise:6000}),call(b,'post','/commerce/student/orders',{...selected,paymentMethod:'UPI',expectedTotalPaise:6000})]);
 assert.deepEqual(race.map(r=>r.status).sort(),[201,409]);checks+=2;
 const winningIndex=race.findIndex(r=>r.status===201),winner=winningIndex===0?a:b,loser=winningIndex===0?b:a,group=race[winningIndex]!.body.data;
 assert.equal(await prisma.orderGroup.count({where:{couponId:coupon.id,status:'PENDING'}}),1);
 status(await call(loser,'post',`/commerce/student/orders/${group.id}/cancel`),409);
 status(await call(winner,'post',`/commerce/student/orders/${group.id}/cancel`),200);
 const reordered=status(await call(a,'post','/commerce/student/orders',{...selected,paymentMethod:'BANK_TRANSFER',paymentReference:'TEST-ONLY',expectedTotalPaise:6000}),201).body.data;
 assert.equal(reordered.orders.reduce((n:number,o:{amountPaise:number})=>n+o.amountPaise,0),6000);
 assert.equal(await prisma.directEnrollment.count({where:{userId:a.body.data.user.id,courseId:{in:[first.id,second.id]}}}),0);
 status(await call(a,'post',`/commerce/admin/orders/${reordered.id}/approve`,{note:'Self approval'}),403);
 status(await call(adminLogin,'post',`/academy/admin/orders/${reordered.orders[0].id}/approve`,{note:'Partial bundle'}),409);
 status(await call(adminLogin,'post',`/commerce/admin/orders/${reordered.id}/approve`,{note:'Verified synthetic payment'}),200);
 assert.equal(await prisma.directEnrollment.count({where:{userId:a.body.data.user.id,courseId:{in:[first.id,second.id]},status:'ACTIVE'}}),2);
 assert.equal(await prisma.courseOrder.count({where:{orderGroupId:reordered.id,status:'PAID'}}),2);
 status(await call(adminLogin,'post',`/commerce/admin/orders/${reordered.id}/approve`,{note:'Repeated approval'}),409);
 status(await call(a,'post',`/commerce/student/orders/${reordered.id}/cancel`),409);
 status(await call(b,'post','/commerce/student/quote',selected),409);
 const expired=status(await call(adminLogin,'post','/commerce/admin/coupons',{code:`OLD${stamp}`,kind:'FIXED',value:1000,courseId:first.id,expiresAt:new Date(0).toISOString(),usageLimit:null}),201).body.data;
 status(await call(b,'post','/commerce/student/quote',{courseId:first.id,couponCode:expired.code}),422);
 status(await call(b,'put',`/commerce/student/wishlist/${first.id}`,{saved:true}),200);
 const wishes=status(await call(b,'get','/commerce/student/wishlist'),200).body.data;assert.ok(wishes.some((w:{courseId:string})=>w.courseId===first.id));
 assert.equal(status(await call(a,'get','/commerce/student/wishlist'),200).body.data.length,0);
 status(await call(b,'put',`/commerce/student/wishlist/${first.id}`,{saved:false}),200);
 status(await call(b,'put',`/commerce/student/reviews/${first.id}`,{rating:5,body:'Cannot review an unpaid course'}),403);
 const review=status(await call(a,'put',`/commerce/student/reviews/${first.id}`,{rating:5,body:'Verified fixture purchase review'}),200).body.data;
 assert.equal(status(await request(app).get(`/api/v1/commerce/courses/${first.id}/reviews`),200).body.data.length,0);
 status(await call(a,'patch',`/commerce/admin/reviews/${review.id}`,{status:'APPROVED',note:'Self publish'}),403);
 status(await call(adminLogin,'patch',`/commerce/admin/reviews/${review.id}`,{status:'APPROVED',note:'Meets review guidelines'}),200);
 const published=status(await request(app).get(`/api/v1/commerce/courses/${first.id}/reviews`),200).body.data;assert.equal(published.length,1);assert.equal(published[0].user.email,undefined);
 status(await call(a,'put',`/commerce/student/reviews/${first.id}`,{rating:4,body:'Edited review needs fresh moderation'}),200);
 assert.equal(status(await request(app).get(`/api/v1/commerce/courses/${first.id}/reviews`),200).body.data.length,0);
 assert.equal(await prisma.auditLog.count({where:{action:'PURCHASE_MANUAL_VERIFY',entityId:reordered.id}}),1);
 console.log(`PASS: ${checks} commerce HTTP assertions plus coupon concurrency, atomic bundle enrollment, exact price allocation and moderated review persistence.`);
}finally{await prisma.$disconnect();}
