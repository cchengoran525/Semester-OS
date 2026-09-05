import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppDataProvider } from './components/AppProvider';
import { Layout } from './components/Layout';
import { Dashboard } from './pages/Dashboard';
import { CalendarPage } from './pages/CalendarPage';
import { TasksPage } from './pages/TasksPage';
import { ProjectsPage } from './pages/ProjectsPage';
import { CoursesPage } from './pages/CoursesPage';
import { SemesterPage } from './pages/SemesterPage';
import { ReviewPage } from './pages/ReviewPage';
import { SettingsPage } from './pages/SettingsPage';

export default function App() {
  return (
    <AppDataProvider>
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="tasks" element={<TasksPage />} />
            <Route path="projects" element={<ProjectsPage />} />
            <Route path="courses" element={<CoursesPage />} />
            <Route path="semester" element={<SemesterPage />} />
            <Route path="review" element={<ReviewPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Routes>
      </HashRouter>
    </AppDataProvider>
  );
}
