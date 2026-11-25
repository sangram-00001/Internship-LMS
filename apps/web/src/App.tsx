import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext';
import { AppLayout } from './components/Layout';
import { Spinner } from './components/UI';
import { AdminCourseBuilder } from './pages/CourseBuilder';
import { Information } from './pages/Information';
import { AdminAccess } from './pages/CourseAccess';
import { StudentProfile, EnrollmentReport } from './pages/Analytics';
import { AdminCommunication, Notifications, Support } from './pages/Communication';
import { AdminCommerce, StudentCommerce, Bundles } from './pages/Commerce';
import { AdminCertificates, StudentCertificates, VerifyCertificate } from './pages/Certificates';
import { AdminAssessments, StudentAssessments } from './pages/Assessments';
import { AccountLink, Profile } from './pages/Account';
import { Login, Register } from './pages/Access';
import { Landing, Catalog, CourseDetails } from './pages/Public';
import { AdminDashboard, AdminCourses, AdminStudents, AdminOrders } from './pages/AcademyAdmin';
import { StudentDashboard, StudentLearn, StudentOrders } from './pages/AcademyStudent';
function Guard({ role }: { role: 'PLATFORM' | 'STUDENT' }) {
  const { me, loading } = useAuth();
  if (loading) return <div className="app-loader"><Spinner/></div>;
  if (!me) return <Navigate to="/login" replace/>;
  if (me.scope !== role) return <Navigate to={me.scope === 'PLATFORM' ? '/admin' : '/student'} replace/>;
  return <AppLayout/>;
}
export default function App() {
 return <BrowserRouter><AuthProvider><Routes>
   <Route path="/" element={<Landing/>}/>
   <Route path="/verify-certificate" element={<VerifyCertificate/>}/>
   <Route path="/verify-certificate/:id" element={<VerifyCertificate/>}/>
   <Route path="/about" element={<Information page="about"/>}/>
   <Route path="/faq" element={<Information page="faq"/>}/>
   <Route path="/contact" element={<Information page="contact"/>}/>
   <Route path="/bundles" element={<Bundles/>}/>
   <Route path="/courses" element={<Catalog/>}/>
   <Route path="/courses/:id" element={<CourseDetails/>}/>
   <Route path="/login" element={<Login/>}/>
   <Route path="/forgot-password" element={<AccountLink mode="forgot"/>}/>
   <Route path="/reset-password" element={<AccountLink mode="reset"/>}/>
   <Route path="/verify-email" element={<AccountLink mode="verify"/>}/>
   <Route path="/register" element={<Register/>}/>
   <Route element={<Guard role="PLATFORM"/>}>
     <Route path="/admin/profile" element={<Profile/>}/>
     <Route path="/admin" element={<AdminDashboard/>}/>
     <Route path="/admin/courses" element={<AdminCourses/>}/>
     <Route path="/admin/courses/:id" element={<AdminCourseBuilder/>}/>
     <Route path="/admin/communication" element={<AdminCommunication/>}/>
     <Route path="/admin/support" element={<Support/>}/>
     <Route path="/admin/commerce" element={<AdminCommerce/>}/>
     <Route path="/admin/certificates" element={<AdminCertificates/>}/>
     <Route path="/admin/assessments" element={<AdminAssessments/>}/>
     <Route path="/admin/reports" element={<EnrollmentReport/>}/>
     <Route path="/admin/students/:id" element={<StudentProfile/>}/>
     <Route path="/admin/students" element={<AdminStudents/>}/>
     <Route path="/admin/access" element={<AdminAccess/>}/>
     <Route path="/admin/orders" element={<AdminOrders/>}/>
   </Route>
   <Route element={<Guard role="STUDENT"/>}>
     <Route path="/student/notifications" element={<Notifications/>}/>
     <Route path="/student/support" element={<Support/>}/>
     <Route path="/student/wishlist" element={<StudentCommerce/>}/>
     <Route path="/student/certificates" element={<StudentCertificates/>}/>
     <Route path="/student/assessments" element={<StudentAssessments/>}/>
     <Route path="/student/profile" element={<Profile/>}/>
     <Route path="/student" element={<StudentDashboard/>}/>
     <Route path="/student/courses" element={<StudentDashboard/>}/>
     <Route path="/student/learn/:id" element={<StudentLearn/>}/>
     <Route path="/student/orders" element={<StudentOrders/>}/>
   </Route>
   <Route path="*" element={<div className="academy-container"><h1>Page not found</h1><a href="/">Return home</a></div>}/>
 </Routes></AuthProvider></BrowserRouter>;
}
