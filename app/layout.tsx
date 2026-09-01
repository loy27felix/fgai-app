import type { Metadata } from "next";
import AppVersionBadge from "@/components/AppVersionBadge";
import ClientErrorReporter from "@/components/ClientErrorReporter";
import SystemVersionGate from "@/components/SystemVersionGate";
import { getDeploymentVersion, SYSTEM_VERSION } from "@/lib/version";
import "./globals.css";

export const metadata: Metadata = {
  title: "FG Studio — AI 漫剧制作平台",
  description: "FableGlitch 内部 AI 漫剧工业化工作流",
  icons: {
    icon: [{ url: "/fg-logo.svg", type: "image/svg+xml" }],
    shortcut: ["/fg-logo.svg"],
    apple: [{ url: "/fg-logo.svg", type: "image/svg+xml" }],
  },
};

const themeScript = `try{var t=localStorage.getItem('fg-theme');if(t==='light'){document.documentElement.classList.remove('dark')}else{document.documentElement.classList.add('dark')}}catch(e){document.documentElement.classList.add('dark')}`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="dark">
      <head><script dangerouslySetInnerHTML={{ __html: themeScript }} /></head>
      <body>
        <AppVersionBadge />
        <SystemVersionGate />
        <ClientErrorReporter deploymentVersion={getDeploymentVersion()} systemVersion={SYSTEM_VERSION} />
        {children}
      </body>
    </html>
  );
}
