import { Board } from "@/components/Board/Board";
import { AppShell } from "@/components/Shell/AppShell";

export default function BoardPage() {
  return (
    <AppShell section="board">
      <Board />
    </AppShell>
  );
}
