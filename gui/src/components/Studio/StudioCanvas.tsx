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
import { api, ApiError, type ClaudeAgent, type InstalledPlugin } from "@/lib/api";
import type { AgentGraph, GraphRecord, NodeRun } from "@/types";
import { useBoardStore } from "@/store/boardStore";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { AgentNode, type AgentNodeData } from "./AgentNode";

const EMPTY_NODE_RUNS: Record<string, NodeRun> = Object.freeze({}) as Record<string, NodeRun>;
import { AgentEditDrawer } from "./AgentEditDrawer";
import { AgentsSidebar } from "./AgentsSidebar";
import { NodeRunPanel } from "./NodeRunPanel";
import { SkillsSidebar } from "./SkillsSidebar";
import { StudioToolbar } from "./StudioToolbar";

interface StudioCanvasProps {
  projectId: string;
  taskId?: string;
}

interface ValidationState {
  reason: string;
  ids: Set<string>;
}

const NODE_TYPES: NodeTypes = { agent: AgentNode };

function buildNodes(
  agents: ClaudeAgent[],
  graphNodes: AgentGraph["nodes"],
  onEdit: (slug: string) => void,
  onRemoveSkill: (slug: string, skillId: string) => void,
  onAddSkill: (slug: string, skillId: string) => void,
): Node[] {
  const graphSlugs = new Set(graphNodes.map((n) => n.data.slug));
  return agents
    .filter((agent) => agent.slug === "main" || graphSlugs.has(agent.slug))
    .map((agent, i) => {
      const isMain = agent.slug === "main";
      const saved = graphNodes.find((n) => n.data.slug === agent.slug);
      const position = isMain
        ? { x: 20, y: 20 }
        : saved?.position ?? { x: 60 + (i % 4) * 260, y: 60 + Math.floor(i / 4) * 160 };
      return {
        id: agent.slug,
        type: "agent",
        position,
        draggable: !isMain,
        data: { agent, onEdit, onRemoveSkill, onAddSkill, isMain } as unknown as Record<string, unknown>,
      };
    });
}

export function StudioCanvas({ projectId, taskId: explicitTaskId }: StudioCanvasProps) {
  const [agents, setAgents] = useState<ClaudeAgent[]>([]);
  const [graph, setGraph] = useState<AgentGraph>({ nodes: [], edges: [] });
  const [installedSkills, setInstalledSkills] = useState<InstalledPlugin[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [editSlug, setEditSlug] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validation, setValidation] = useState<ValidationState | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  // Multi-graph state
  const [graphRecords, setGraphRecords] = useState<GraphRecord[]>([]);
  const [activeGraphId, setActiveGraphId] = useState<string | null>(null);
  const [newGraphName, setNewGraphName] = useState("");
  const [showNewGraphInput, setShowNewGraphInput] = useState(false);
  const [creatingGraph, setCreatingGraph] = useState(false);
  const [confirmDeleteGraph, setConfirmDeleteGraph] = useState(false);
  const [deletingGraph, setDeletingGraph] = useState(false);
  const [genOpen, setGenOpen] = useState(false);

  // Auto-bind: if no explicit ?taskId=, fall back to a "doing" task in this project.
  // Lets the user open Studio normally and still see live overlay.
  const autoBoundTaskId = useBoardStore((s) => {
    if (explicitTaskId) return undefined;
    const candidates = Object.values(s.tasks).filter(
      (t) => t.projectId === projectId && t.status === "doing",
    );
    return candidates.length === 1 ? candidates[0]!.id : undefined;
  });
  const taskId = explicitTaskId ?? autoBoundTaskId;

  const taskRef = useBoardStore((s) =>
    taskId ? s.tasks[taskId]?.displayId ?? taskId : undefined,
  );

  const boundTaskGraphId = useBoardStore((s) =>
    taskId ? (s.tasks[taskId]?.graphId ?? null) : null,
  );

  const upsertNodeRun = useBoardStore((s) => s.upsertNodeRun);
  const appendNodeLog = useBoardStore((s) => s.appendNodeLog);

  // Backfill past NodeRuns on bind. WS only delivers future events; rows
  // recorded before this client mounted (e.g. user dragged the task to doing
  // before opening Studio) live only in the DB until we fetch them here.
  useEffect(() => {
    if (!taskId) return;
    let cancelled = false;
    void api
      .getNodeRuns(taskId)
      .then((runs) => {
        if (cancelled) return;
        for (const run of runs) {
          upsertNodeRun(run);
          const buffered = run.outputArtifact?.logLines;
          if (Array.isArray(buffered)) {
            for (const line of buffered) {
              appendNodeLog(taskId, run.nodeId, line as string);
            }
          }
        }
      })
      .catch((err) => {
        // best-effort backfill; live WS events still arrive even if this fails
        console.warn("[Studio] backfill nodeRuns failed:", err);
      });
    return () => {
      cancelled = true;
    };
  }, [taskId, upsertNodeRun, appendNodeLog]);

  const nodeRuns = useBoardStore((s) =>
    taskId ? s.nodeRuns[taskId] ?? EMPTY_NODE_RUNS : EMPTY_NODE_RUNS,
  );

  const onAbortNode = useCallback(
    async (nodeId: string) => {
      if (!taskId) return;
      try {
        await api.abortNode(taskId, nodeId);
      } catch {
        // 409 race is expected when a node finishes between click and request
      }
    },
    [taskId],
  );

  const onRetryNode = useCallback(
    async (nodeId: string) => {
      if (!taskId) return;
      try {
        await api.retryNode(taskId, nodeId);
      } catch {
        // surfaced via task error agent log
      }
    },
    [taskId],
  );

  const onSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
  }, []);

  const onEdit = useCallback((slug: string) => {
    setEditSlug(slug);
    setDrawerOpen(true);
  }, []);

  const screenToFlowPositionRef = useRef<((pos: { x: number; y: number }) => { x: number; y: number }) | null>(null);

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

  const canvasNodeIds = useMemo(() => new Set(nodes.map((n) => n.id)), [nodes]);

  const handleAddAgentToCanvas = useCallback(
    (slug: string, pos: { x: number; y: number }) => {
      if (slug === "main") return;
      if (nodes.some((n) => n.id === slug)) return;
      const agent = agents.find((a) => a.slug === slug);
      if (!agent) return;
      const newNode: Node = {
        id: slug,
        type: "agent",
        position: pos,
        draggable: true,
        data: { agent, onEdit, onRemoveSkill, onAddSkill, isMain: false } as unknown as Record<string, unknown>,
      };
      setNodes((prev) => [...prev, newNode]);
      setIsDirty(true);
    },
    [agents, nodes, onEdit, onRemoveSkill, onAddSkill, setNodes],
  );

  const prevProjectId = useRef<string | null>(null);

  // Load graph records for the multi-graph selector
  const loadGraphRecords = useCallback(async () => {
    try {
      const resp = await api.listGraphs(projectId);
      const unique = resp.graphs.filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i);
      setGraphRecords(unique);
      setActiveGraphId((prev) => {
        if (prev) return prev;
        return resp.graphs[0]?.id ?? null;
      });
    } catch {
      // non-fatal; legacy single-graph still works
    }
  }, [projectId]);

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
    // Also refresh graph records
    void loadGraphRecords();
  }, [projectId, onEdit, onRemoveSkill, onAddSkill, setNodes, setEdges, loadGraphRecords]);

  useEffect(() => {
    // Fires on initial mount (prev=null !== projectId) AND on projectId
    // change. The previous duplicate mount-only useEffect was removed because
    // double-loadAll wiped freshly-applied runState (race with the backfill
    // upsertNodeRun cycle).
    if (prevProjectId.current !== projectId) {
      prevProjectId.current = projectId;
      void loadAll();
    }
  }, [projectId, loadAll]);

  // When a task binds (or its graphId changes) and graphRecords are loaded,
  // switch the canvas to the task's graph automatically.
  useEffect(() => {
    if (!boundTaskGraphId || !graphRecords.length) return;
    if (boundTaskGraphId === activeGraphId) return;
    const record = graphRecords.find((g) => g.id === boundTaskGraphId);
    if (record) {
      setActiveGraphId(record.id);
      loadGraphData(record.data);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId, graphRecords.length]);

  // Sync runState/validation into node.data via setNodes (instead of a useMemo
  // that builds a new Node[] each render). New Node[] refs cause ReactFlow to
  // remeasure and visually drop edges; in-place data update keeps edges stable.
  useEffect(() => {
    setNodes((prev) =>
      prev.map((n) => {
        const d = n.data as unknown as AgentNodeData;
        const runRow = nodeRuns[n.id];
        const runState = runRow
          ? {
              status: runRow.status,
              nodeRunId: runRow.id,
              tokens: {
                input: runRow.inputTokens,
                output: runRow.outputTokens,
              },
              model: runRow.model,
            }
          : undefined;
        const validationError =
          validation && validation.ids.has(n.id)
            ? { reason: validation.reason }
            : undefined;
        const sameRun =
          d.runState?.status === runState?.status &&
          d.runState?.nodeRunId === runState?.nodeRunId;
        const sameValidation =
          d.validationError?.reason === validationError?.reason;
        if (sameRun && sameValidation) return n;
        return {
          ...n,
          data: {
            ...d,
            runState,
            validationError,
            onAbortNode: taskId ? onAbortNode : undefined,
            onRetryNode: taskId ? onRetryNode : undefined,
            onSelectNode: taskId ? onSelectNode : undefined,
          } as unknown as Record<string, unknown>,
        };
      }),
    );
  }, [nodeRuns, validation, taskId, onAbortNode, onRetryNode, onSelectNode, setNodes, nodes.length]);

  const handleNodesChange = useCallback(
    (changes: Parameters<typeof onNodesChange>[0]) => {
      const filtered = changes.filter((c) => {
        if (c.type === "remove") return c.id !== "main";
        return true;
      });
      onNodesChange(filtered);
      const hasMoved = filtered.some((c) => c.type === "position" && !c.dragging);
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

  // Confirm dialog state for empty-edges guard
  const [confirmSaveEmpty, setConfirmSaveEmpty] = useState(false);
  const pendingSaveRef = useRef(false);

  const doSave = useCallback(async () => {
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
      if (activeGraphId) {
        // Save to the selected named graph record
        const updated = await api.updateGraph(projectId, activeGraphId, { data: payload });
        setGraphRecords((prev) =>
          prev.map((g) => (g.id === activeGraphId ? updated : g)),
        );
      } else {
        // Save to the legacy single project graph
        await api.putProjectGraph(projectId, payload);
      }
      setIsDirty(false);
      setValidation(null);
    } catch (err) {
      if (err instanceof ApiError && err.status === 400) {
        const body = err.body as
          | { error?: string; reason?: string; offendingNodeIds?: string[] }
          | undefined;
        if (body?.error === "graph_invalid" && body.reason) {
          setValidation({
            reason: body.reason,
            ids: new Set(body.offendingNodeIds ?? []),
          });
        }
      }
      // leave dirty so user can retry
    } finally {
      setSaving(false);
    }
  }, [nodes, edges, activeGraphId, projectId]);

  const handleSave = async () => {
    // Guard: refuse to write a multi-node graph with zero edges.
    if (nodes.length > 1 && edges.length === 0) {
      pendingSaveRef.current = true;
      setConfirmSaveEmpty(true);
      return;
    }
    await doSave();
  };

  // Load a selected GraphRecord's data into the canvas
  const loadGraphData = useCallback(
    (graphData: AgentGraph) => {
      setGraph(graphData);
      setNodes(buildNodes(agents, graphData.nodes, onEdit, onRemoveSkill, onAddSkill));
      setEdges(graphData.edges.map((e) => ({ id: e.id, source: e.source, target: e.target })));
      setIsDirty(false);
      setValidation(null);
    },
    [agents, onEdit, onRemoveSkill, onAddSkill, setNodes, setEdges],
  );

  const handleSelectGraph = useCallback(
    (graphId: string | null) => {
      setActiveGraphId(graphId);
      if (!graphId) {
        // Revert to default project graph
        void api.getProjectGraph(projectId).then(loadGraphData).catch(() => {});
        return;
      }
      const record = graphRecords.find((g) => g.id === graphId);
      if (record) loadGraphData(record.data);
    },
    [graphRecords, projectId, loadGraphData],
  );

  const handleCreateGraph = useCallback(async () => {
    const name = newGraphName.trim();
    if (!name) return;
    setCreatingGraph(true);
    try {
      const record = await api.createGraph(projectId, { name, data: { nodes: [], edges: [] } });
      const fresh = await api.listGraphs(projectId);
      const unique = fresh.graphs.filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i);
      setGraphRecords(unique);
      setActiveGraphId(record.id);
      loadGraphData({ nodes: [], edges: [] });
      setNewGraphName("");
      setShowNewGraphInput(false);
    } catch {
      // ignore; user can retry
    } finally {
      setCreatingGraph(false);
    }
  }, [newGraphName, projectId, loadGraphData]);

  const handleSaveCurrentGraph = useCallback(async () => {
    const currentGraphData: AgentGraph = {
      nodes: nodes.map((n) => ({
        id: n.id,
        type: "agent" as const,
        position: n.position,
        data: { slug: n.id },
      })),
      edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
    };
    if (activeGraphId) {
      try {
        const updated = await api.updateGraph(projectId, activeGraphId, {
          data: currentGraphData,
        });
        setGraphRecords((prev) =>
          prev.map((g) => (g.id === activeGraphId ? updated : g)),
        );
        setIsDirty(false);
        setValidation(null);
      } catch {
        // leave dirty
      }
    }
  }, [activeGraphId, projectId, nodes, edges]);

  const handleDeleteGraph = useCallback(async () => {
    if (!activeGraphId) return;
    setDeletingGraph(true);
    try {
      await api.deleteGraph(projectId, activeGraphId);
      const fresh = await api.listGraphs(projectId);
      const unique = fresh.graphs.filter((g, i, arr) => arr.findIndex((x) => x.id === g.id) === i);
      setGraphRecords(unique);
      const next = unique[0] ?? null;
      setActiveGraphId(next?.id ?? null);
      if (next) loadGraphData(next.data);
      else loadGraphData({ nodes: [], edges: [] });
    } catch {
      // ignore
    } finally {
      setDeletingGraph(false);
      setConfirmDeleteGraph(false);
    }
  }, [activeGraphId, projectId, loadGraphData]);

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

  const activeGraphName =
    activeGraphId
      ? (graphRecords.find((g) => g.id === activeGraphId)?.name ?? "Graph")
      : "Default";

  return (
    <div className="flex h-full flex-col">
      <StudioToolbar
        projectId={projectId}
        installedSkills={installedSkills}
        onAgentCreated={async () => { await loadAll(); }}
        genOpen={genOpen}
        onSetGenOpen={setGenOpen}
      />

      {/* Graph selector toolbar */}
      <div className="flex items-center gap-2 border-b border-[var(--border)] bg-[var(--bg-base)] px-4 py-1.5">
        <span className="font-mono text-[10px] uppercase tracking-widest text-[var(--text-faint)]">
          Graph:
        </span>
        <select
          value={activeGraphId ?? graphRecords[0]?.id ?? ""}
          onChange={(e) => handleSelectGraph(e.target.value || null)}
          className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--text-secondary)] focus:border-[var(--text-secondary)] focus:outline-none"
          title="Select graph"
        >
          {graphRecords.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>

        {/* New graph inline input */}
        {showNewGraphInput ? (
          <>
            <input
              type="text"
              value={newGraphName}
              onChange={(e) => setNewGraphName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleCreateGraph();
                if (e.key === "Escape") { setShowNewGraphInput(false); setNewGraphName(""); }
              }}
              placeholder="Graph name..."
              autoFocus
              className="border border-[var(--border)] bg-[var(--bg-surface)] px-2 py-1 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-faint)] focus:border-[var(--text-secondary)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void handleCreateGraph()}
              disabled={creatingGraph || !newGraphName.trim()}
              className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
            >
              {creatingGraph ? "..." : "Create"}
            </button>
            <button
              type="button"
              onClick={() => { setShowNewGraphInput(false); setNewGraphName(""); }}
              className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]"
            >
              Cancel
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowNewGraphInput(true)}
            title="Create new graph"
            className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--text-secondary)] transition hover:border-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            + New
          </button>
        )}

        {/* Delete current graph — disabled for default */}
        {(() => {
          const activeRecord = graphRecords.find((g) => g.id === activeGraphId);
          const isDefault = !activeGraphId || activeRecord?.name === "default";
          return (
            <button
              type="button"
              onClick={() => setConfirmDeleteGraph(true)}
              disabled={isDefault || deletingGraph}
              title={isDefault ? "Cannot delete the default graph" : "Delete this graph"}
              className="border border-[var(--border)] px-2 py-1 font-mono text-[10px] text-[var(--text-muted)] transition hover:border-[var(--status-error)] hover:text-[var(--status-error)] disabled:opacity-30 disabled:cursor-not-allowed"
            >
              Del
            </button>
          );
        })()}
      </div>

      <div className="flex min-h-0 flex-1">
        <SkillsSidebar
          projectId={projectId}
          onSkillsChanged={() => void loadAll()}
        />

        <div className="relative flex-1">
          {/* Run-trace banner */}
          {taskId && (
            <div className="absolute left-4 top-4 z-10 flex items-center gap-2 rounded border border-blue-500/40 bg-blue-500/10 px-3 py-1.5 text-[11px] text-blue-300 shadow">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-blue-400" />
              <span className="font-mono">
                Live: {taskRef ?? taskId}
                {!explicitTaskId && (
                  <span className="ml-1 text-[10px] text-blue-400/60">(auto)</span>
                )}
                <span className="ml-1 text-[10px] text-blue-400/60">
                  ({Object.keys(nodeRuns).length} runs:{" "}
                  {Object.keys(nodeRuns).join(",") || "—"})
                </span>
              </span>
            </div>
          )}

          {/* Agent count + Save button */}
          <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-1.5">
            <span
              title={nodes.length > 5 ? "Recommended max is 5 agents — coordinator overhead grows beyond this." : "Recommended max for Claude orchestration: 5 agents."}
              className={[
                "inline-flex items-center gap-1 border px-2 py-0.5 font-mono text-[10px]",
                nodes.length > 5
                  ? "border-[var(--status-warning)] text-[var(--status-warning)]"
                  : "border-[var(--border)] bg-[var(--bg-base)] text-[var(--text-muted)]",
              ].join(" ")}
            >
              {nodes.length}<span className="text-[var(--text-faint)]">/5</span>
              <span className="text-[var(--text-faint)]">agents</span>
            </span>
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
            zoomOnDoubleClick={false}
            onNodeDoubleClick={(_, node) => onEdit(node.id)}
            onNodeDragStop={(_, node) => {
              if (node.id === "main") {
                setNodes((prev) =>
                  prev.map((n) => (n.id === "main" ? { ...n, position: { x: 20, y: 20 } } : n)),
                );
              } else {
                setIsDirty(true);
              }
            }}
            deleteKeyCode={["Delete", "Backspace"]}
            edgesFocusable
            onEdgeClick={(_, edge) => {
              setEdges((eds) => eds.filter((e) => e.id !== edge.id));
              setIsDirty(true);
            }}
            onInit={(instance) => { screenToFlowPositionRef.current = instance.screenToFlowPosition; }}
            onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "copy"; }}
            onDrop={(e) => {
              e.preventDefault();
              const agentSlug = e.dataTransfer.getData("application/x-agent-slug");
              if (agentSlug && screenToFlowPositionRef.current) {
                const pos = screenToFlowPositionRef.current({ x: e.clientX, y: e.clientY });
                handleAddAgentToCanvas(agentSlug, pos);
                return;
              }
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

          {validation && (
            <div className="absolute left-4 top-4 z-10 max-w-[400px] rounded border border-rose-500 bg-[var(--bg-base)] px-3 py-2 text-[11px] text-rose-500 shadow">
              Graph invalid: <span className="font-mono">{validation.reason}</span>
              {validation.ids.size > 0 && (
                <span className="ml-1 font-mono text-[10px] text-[var(--text-muted)]">
                  ({[...validation.ids].join(", ")})
                </span>
              )}
            </div>
          )}
        </div>

        <AgentsSidebar
          agents={agents}
          canvasNodeIds={canvasNodeIds}
          onNewAgent={() => { setEditSlug(null); setDrawerOpen(true); }}
          onGenerate={() => setGenOpen(true)}
        />

        {taskId && (
          <NodeRunPanel
            taskId={taskId}
            nodeId={selectedNodeId}
            onClose={() => setSelectedNodeId(null)}
          />
        )}
      </div>

      <div className="flex items-center gap-1.5 border-t border-[var(--border)] bg-[var(--bg-surface)] px-3 py-1.5">
        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-[var(--text-muted)]"><circle cx="8" cy="8" r="7"/><path d="M8 7v4M8 5h.01"/></svg>
        <span className="font-mono text-[10px] text-[var(--text-faint)]">
          Project CLAUDE.md and hooks remain active during graph execution — they may influence node behavior.
        </span>
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

      <ConfirmDialog
        open={confirmDeleteGraph}
        title="Delete graph?"
        description={`"${activeGraphName}" will be permanently deleted. This cannot be undone.`}
        confirmLabel={deletingGraph ? "Deleting..." : "Delete"}
        cancelLabel="Cancel"
        variant="danger"
        onConfirm={() => void handleDeleteGraph()}
        onCancel={() => setConfirmDeleteGraph(false)}
      />

      <ConfirmDialog
        open={confirmSaveEmpty}
        title="Save graph with no edges?"
        description="This graph has multiple nodes but no edges. Saving will overwrite the existing connections on disk. Continue?"
        confirmLabel="Save anyway"
        cancelLabel="Cancel"
        variant="warning"
        onConfirm={() => {
          setConfirmSaveEmpty(false);
          pendingSaveRef.current = false;
          void doSave();
        }}
        onCancel={() => {
          setConfirmSaveEmpty(false);
          pendingSaveRef.current = false;
        }}
      />
    </div>
  );
}
