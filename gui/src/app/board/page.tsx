import { Board } from "@/components/Board/Board";
import { IconSidebar } from "@/components/Layout/IconSidebar";
import { Header } from "@/components/Layout/Header";
import { TaskDetailDrawer } from "@/components/Card/TaskDetailDrawer";
import { ToastContainer } from "@/components/ui/Toast";

export default function BoardPage() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100vh",
        overflow: "hidden",
        background: "var(--cf-bg)",
        fontFamily: "var(--font-inter, Inter, sans-serif)",
      }}
    >
      <Header />
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        <IconSidebar />
        <main
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            background: "var(--cf-bg)",
          }}
        >
          <Board />
        </main>
      </div>
      <TaskDetailDrawer />
      <ToastContainer />
    </div>
  );
}
