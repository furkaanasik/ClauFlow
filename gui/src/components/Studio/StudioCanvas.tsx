"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type NodeTypes,
  type Node,
  type Edge,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import { api, type ClaudeAgent, type InstalledPlugin } from "@/lib/api";
import type { AgentGraph } from "@/types";
import { AgentNode, type AgentNodeData } from "./AgentNode";
import { AgentEditDrawer } from "./AgentEditDrawer";
import { SkillsSidebar } from "./SkillsSidebar";
import { StudioToolbar } from "./StudioToolbar";

interface StudioCanvasProps {
  projectId: string;
}

const NODE_TYPES: NodeTypes = { agent: AgentNode };

function buildNodes(
  agents: ClaudeAgent[],
  graphNodes: AgentGraph["nodes"],
  onEdit: (slug: string) => void,
  onRemoveSkill: (slug: string, skillId: string) => void,
  onAddSkill: (slug: string, skillId: string) => void,
): Node[] {
  return agents.map((agent, i) => {
    const saved = graphNodes.find((n) => n.data.slug === agent.slug);
    return {
      id: agent.slug,
      type: "agent",
      position: saved?.position ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 160 },
      data: { agent, onEdit, onRemoveSkill, onAddSkill } as unknown as Record<string, unknown>,
    };
  });
}

export function StudioCanvas({ projectId }: StudioCanvasProps) {
  const [agents, setAgents] = useState<ClaudeAgent[]>([]);
  const [graph, setGraph] = useState<AgentGraph>({ nodes: [], edges: [] });
  const [installedSkills, setInstalledSkills] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  const onEdit = useCallback((slug: string) => {
    setEditSlug(slug);
    setDrawerOpen(true);
  }, []);

  const removeSkillRef = useRef<(slug: string, skillId: string) => void>(() => {});
  const onRemoveSkill = useCallback((slug: string, skillId: string) => {
    removeSkillRef.current(slug, skillId);
  }, []);

  const addSkillRef = useRef<(slug: string, skillId: string) => void>(() => {});
  const onAddSkill = useCallback((slug: string, skillId: string) => {
    addSkillRef.current(slug, skillId);
  }, []);

  const nodeData = useMemo<Node[]>(
    () => buildNodes(agents, graph.nodes, onEdit, onRemoveSkill, onAddSkill),
    [agents, graph.nodes, onEdit, onRemoveSkill, onAddSkill],
  );

  const [nodes, setNodes, onNodesChange] = useNodesState(nodeData);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(
    graph.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  );

  const prevProjectId = useRef<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [agentsResp, graphResp, skillsResp] = await Promise.allSettled([
        api.listClaudeAgents(projectId),
        api.getProjectGraph(projectId),
        api.listInstalledSkills(projectId),
      ]);

      const agentList =
        agentsResp.status === "fulfilled" ? agentsResp.value.agents : [];
      const graphData: AgentGraph =
        graphResp.status === "fulfilled"
          ? graphResp.value
          : { nodes: [], edges: [] };
      const skillList =
        skillsResp.status === "fulfilled" ? skillsResp.value.installed : [];

      setAgents(agentList);
      setGraph(graphData);
      setInstalledSkills(skillList);

      setNodes(buildNodes(agentList, graphData.nodes, onEdit, onRemoveSkill, onAddSkill));
      setEdges(graphData.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load canvas");
    } finally {
      setLoading(false);
      setIsDirty(false);
    }
  }, [projectId, onEdit, onRemoveSkill, onAddSkill, setNodes, setEdges]);

  useEffect(() => {
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId;
      void loadAll();
    }
  }, [projectId, loadAll]);

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      onNodesChange(changes);
      const hasMoved = changes.some((c) => c.type === "position" && !c.dragging);
      if (hasMoved) setIsDirty(true);
    },
    [onNodesChange],
  );

  const handleEdgesChange = useCallback(
    (changes: Parameters<typeof onEdgesChange>[0]) => {
      onEdgesChange(changes);
      if (changes.some((c) => c.type === "remove")) setIsDirty(true);
    },
    [onEdgesChange],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge(connection, eds));
      setIsDirty(true);
    },
    [setEdges],
  );

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload: AgentGraph = {
        nodes: nodes.map((n) => ({
          id: n.id,
          type: "agent" as const,
          position: n.position,
          data: { slug: n.id },
        })),
        edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
      };
      await api.putProjectGraph(projectId, payload);
      setIsDirty(false);
    } catch {
      // leave dirty so user can retry
    } finally {
      setSaving(false);
    }
  };

  const handleRemoveSkill = useCallback(
    async (nodeId: string, skillId: string) => {
      const agent = agents.find((a) => a.slug === nodeId);
      if (!agent) return;
      const body = agent.body ?? "";
      const sectionRe = /##\s+Available Skills\s*\n([\s\S]*?)(?=\n##|$)/i;
      const sectionMatch = body.match(sectionRe);
      if (!sectionMatch) return;

      const section = sectionMatch[0];
      const rowRe = new RegExp(
        `\\n\\|\\s*${skillId.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\\\$&")}\\s*\\|[^\\n]*`,
      );
      const updatedSection = section.replace(rowRe, "");
      let newBody = body.replace(section, updatedSection);

      const remaining = updatedSection
        .split("\n")
        .filter((l) => l.trim().startsWith("|"))
        .filter((l) => !/^\|\s*Skill\s*\|/i.test(l) && !/^\|\s*-+\s*\|/.test(l));
      if (remaining.length === 0) {
        newBody = body.replace(/\n*##\s+Available Skills[\s\S]*?(?=\n##|$)/i, "");
      }

      setAgents((prev) =>
        prev.map((a) => (a.slug === nodeId ? { ...a, body: newBody } : a)),
      );
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const d = n.data as unknown as AgentNodeData;
          return { ...n, data: { ...d, agent: { ...d.agent, body: newBody } } as unknown as Record<string, unknown> };
        }),
      );

      try {
        await api.updateClaudeAgent(projectId, nodeId, { body: newBody });
      } catch {
        setAgents((prev) =>
          prev.map((a) => (a.slug === nodeId ? { ...a, body } : a)),
        );
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            const d = n.data as unknown as AgentNodeData;
            return { ...n, data: { ...d, agent: { ...d.agent, body } } as unknown as Record<string, unknown> };
          }),
        );
      }
    },
    [agents, projectId, setAgents, setNodes],
  );

  useEffect(() => {
    removeSkillRef.current = handleRemoveSkill;
  }, [handleRemoveSkill]);

  const handleDropOnNode = useCallback(
    async (nodeId: string, skillId: string) => {
      const agent = agents.find((a) => a.slug === nodeId);
      if (!agent) return;

      const body = agent.body ?? "";
      const sectionRe = /##\s+Available Skills\s*\n([\s\S]*?)(?=\n##|$)/i;
      const tableHeader = "| Skill | Description |\n|-------|-------------|";

      let newBody: string;
      const sectionMatch = body.match(sectionRe);
      if (sectionMatch) {
        const existingSection = sectionMatch[0];
        if (existingSection.includes(`| ${skillId} |`)) return; // already there
        const newRow = `| ${skillId} | |`;
        newBody = body.replace(sectionRe, `${existingSection}\n${newRow}`);
      } else {
        const newSection = `\n\n## Available Skills\n\n${tableHeader}\n| ${skillId} | |`;
        newBody = body + newSection;
      }

      // Optimistic update
      setAgents((prev) =>
        prev.map((a) => (a.slug === nodeId ? { ...a, body: newBody } : a)),
      );
      setNodes((prev) =>
        prev.map((n) => {
          if (n.id !== nodeId) return n;
          const d = n.data as unknown as AgentNodeData;
          return { ...n, data: { ...d, agent: { ...d.agent, body: newBody } } as unknown as Record<string, unknown> };
        }),
      );

      try {
        await api.updateClaudeAgent(projectId, nodeId, { body: newBody });
      } catch {
        // Revert
        setAgents((prev) =>
          prev.map((a) => (a.slug === nodeId ? { ...a, body: body } : a)),
        );
        setNodes((prev) =>
          prev.map((n) => {
            if (n.id !== nodeId) return n;
            const d = n.data as unknown as AgentNodeData;
            return { ...n, data: { ...d, agent: { ...d.agent, body } } as unknown as Record<string, unknown> };
          }),
        );
      }
    },
    [agents, projectId, setAgents, setNodes],
  );

  useEffect(() => {
    addSkillRef.current = handleDropOnNode;
  }, [handleDropOnNode]);

  const existingSlugs = agents.map((a) => a.slug);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-[var(--text-muted)]">
        Loading canvas...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <div className="text-[12px] text-[var(--status-error)]">{error}</div>
        <button
          type="button"
          onClick={() => void loadAll()}
          className="border border-[var(--border)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] transition hover:text-[var(--text-primary)]"
        >
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <StudioToolbar
        projectId={projectId}
        installedSkills={installedSkills}
        agentCount={agents.length}
        onNewAgent={() => { setEditSlug(null); setDrawerOpen(true); }}
        onAgentCreated={async () => { await loadAll(); }}
      />

      <div className="flex min-h-0 flex-1">
        <SkillsSidebar
          projectId={projectId}
          onSkillsChanged={() => void loadAll()}
        />

        <div className="relative flex-1">
          {/* Save button */}
          <div className="absolute right-4 top-4 z-10">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={!isDirty || saving}
              className="border border-[var(--border)] bg-[var(--bg-base)] px-3 py-1.5 text-[11px] text-[var(--text-secondary)] shadow transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {saving ? "Saving..." : "Save layout"}
            </button>
          </div>

          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onConnect={handleConnect}
            onNodeDragStop={() => setIsDirty(true)}
            deleteKeyCode={["Delete", "Backspace"]}
            edgesFocusable
            onEdgeClick={(_, edge) => {
              setEdges((eds) => eds.filter((e) => e.id !== edge.id));
              setIsDirty(true);
            }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => {
              e.preventDefault();
              const skillId = e.dataTransfer.getData("application/x-skill-id");
              if (!skillId) return;
              const el = document.elementFromPoint(e.clientX, e.clientY);
              const nodeEl = el?.closest("[data-id]");
              const nodeId = nodeEl?.getAttribute("data-id");
              if (nodeId) void handleDropOnNode(nodeId, skillId);
            }}
            fitView
            proOptions={{ hideAttribution: true }}
            className="bg-[var(--bg-surface)]"
          >
            <Background color="var(--border)" gap={20} />
            <Controls />
          </ReactFlow>
        </div>
      </div>

      <AgentEditDrawer
        projectId={projectId}
        slug={editSlug}
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        onSaved={async () => {
          setDrawerOpen(false);
          await loadAll();
        }}
        onDeleted={async () => {
          setDrawerOpen(false);
          await loadAll();
        }}
        existingSlugs={existingSlugs}
      />
    </div>
  );
}
