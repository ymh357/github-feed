import Link from "next/link";

const NotFound = (): React.JSX.Element => (
  <main style={{ maxWidth: 640, margin: "100px auto", padding: 24 }}>
    <p>404</p>
    <h1>这条内容还没有收录</h1>
    <p>项目可能尚未进入学习库，或这个链接已经失效。</p>
    <Link href="/">返回项目信息流</Link>
  </main>
);

export default NotFound;
