import { Routes, Route, Navigate, Outlet } from "react-router-dom";
import { lazy, Suspense } from "react";
import { DashboardLayout } from "./shared/components";

// Dashboard pages (lazy loaded)
const Providers = lazy(() => import("./pages/providers/page.js"));
const ProviderNew = lazy(() => import("./pages/providers/new/page.js"));
const ProviderDetail = lazy(() => import("./pages/providers/[id]/page.js"));
const Endpoint = lazy(() => import("./pages/endpoint/page.js"));
const Usage = lazy(() => import("./pages/usage/page.js"));
const CliTools = lazy(() => import("./pages/cli-tools/page.js"));
const ProxyPools = lazy(() => import("./pages/proxy-pools/page.js"));
const Combos = lazy(() => import("./pages/combos/page.js"));
const Mitm = lazy(() => import("./pages/mitm/page.js"));
const Profile = lazy(() => import("./pages/profile/page.js"));
const Quota = lazy(() => import("./pages/quota/page.js"));
const Skills = lazy(() => import("./pages/skills/page.js"));
const Translator = lazy(() => import("./pages/translator/page.js"));
const ConsoleLog = lazy(() => import("./pages/console-log/page.js"));
const Logs = lazy(() => import("./pages/logs/page.js"));
const BasicChat = lazy(() => import("./pages/basic-chat/page.js"));
const MediaProviderKind = lazy(() => import("./pages/media-providers/[kind]/page.js"));
const MediaProviderDetail = lazy(() => import("./pages/media-providers/[kind]/[id]/page.js"));
const MediaProviderWeb = lazy(() => import("./pages/media-providers/web/page.js"));
const MediaProviderComboDetail = lazy(() => import("./pages/media-providers/combo/[id]/page.js"));
const Login = lazy(() => import("./pages/login/page.js"));
const Callback = lazy(() => import("./pages/callback/page.js"));
const QuotaWidget = lazy(() => import("./pages/quota-widget/page.js"));

function Loading() {
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="animate-spin w-8 h-8 border-2 border-primary border-t-transparent rounded-full" />
    </div>
  );
}

function DashboardWrapper() {
  return (
    <DashboardLayout>
      <Suspense fallback={<Loading />}>
        <Outlet />
      </Suspense>
    </DashboardLayout>
  );
}

export default function App() {
  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/callback" element={<Callback />} />
        <Route
          path="/quota-widget"
          element={
            <Suspense fallback={<Loading />}>
              <QuotaWidget />
            </Suspense>
          }
        />
        <Route path="/dashboard" element={<DashboardWrapper />}>
          <Route index element={<Navigate to="providers" replace />} />
          <Route path="providers" element={<Providers />} />
          <Route path="providers/new" element={<ProviderNew />} />
          <Route path="providers/:id" element={<ProviderDetail />} />
          <Route path="endpoint" element={<Endpoint />} />
          <Route path="usage" element={<Usage />} />
          <Route path="cli-tools" element={<CliTools />} />
          <Route path="proxy-pools" element={<ProxyPools />} />
          <Route path="combos" element={<Combos />} />
          <Route path="mitm" element={<Mitm />} />
          <Route path="profile" element={<Profile />} />
          <Route path="quota" element={<Quota />} />
          <Route path="skills" element={<Skills />} />
          <Route path="translator" element={<Translator />} />
          <Route path="console-log" element={<ConsoleLog />} />
          <Route path="logs" element={<Logs />} />
          <Route path="basic-chat" element={<BasicChat />} />
          <Route path="media-providers/web" element={<MediaProviderWeb />} />
          <Route path="media-providers/combo/:id" element={<MediaProviderComboDetail />} />
          <Route path="media-providers/:kind/:id" element={<MediaProviderDetail />} />
          <Route path="media-providers/:kind" element={<MediaProviderKind />} />
        </Route>
        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </Suspense>
  );
}
