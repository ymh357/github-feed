"use client";

import Link from "next/link";

const ErrorPage = ({ reset }: { reset: () => void }): React.JSX.Element => (
  <main style={{ maxWidth: 640, margin: "100px auto", padding: 24 }}>
    <h1>内容暂时无法加载</h1>
    <p>请稍后重试。已保存的浏览器收藏仍会保留。</p>
    <button type="button" onClick={reset}>重新加载</button>{" "}
    <Link href="/">返回项目信息流</Link>
  </main>
);

export default ErrorPage;
