import type { Metadata } from "next";
import type { ReactElement, ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "GitHub Feed · 持续发现，深入学习", template: "%s · GitHub Feed" },
  description: "持续发现值得关注的 GitHub 项目与版本更新，通过 What、Why、How 理解项目，并积累自己的学习收藏。",
};

const RootLayout = ({ children }: { children: ReactNode }): ReactElement => <html lang="zh-CN">
  <body>
    <a className="skip-link" href="#main-content">跳到主要内容</a>
    {children}
  </body>
</html>;

export default RootLayout;
