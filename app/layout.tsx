import type { Metadata, Viewport } from "next";
import "@/app/globals.css";

export const metadata: Metadata = {
  title: {
    default: "DDT Insight · 用例数据中枢",
    template: "%s · DDT Insight",
  },
  description:
    "完全离线、高性能的表格用例数据管理平台，支持批量导入、检索、编辑、导出与开放 API。",
  applicationName: "DDT Insight",
  icons: { icon: "/favicon.svg" },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#f5f5f7",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
