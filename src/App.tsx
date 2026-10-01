/**
 * App shell. Layout only — protocol logic lives in engine/simulation.
 */

import { useEffect } from 'react';
import { useApp } from './state/store';
import { useEditor } from './state/editor-store';
import { LabNav } from './components/LabNav';
import { TopologyCanvas } from './components/TopologyCanvas';
import { Timeline } from './components/Timeline';
import { PacketInspector } from './components/PacketInspector';
import { Controls } from './components/Controls';
import { LabDetail } from './components/LabDetail';
import { StatusBar } from './components/StatusBar';
import { TopologyEditor } from './components/TopologyEditor';
import { EventInspector } from './components/EventInspector';
import { ArpCachePanel } from './components/ArpCachePanel';
import { RoutingTableInspector } from './components/RoutingTableInspector';
import { RouterDecisionPanel } from './components/RouterDecisionPanel';
import { DnsInspector } from './components/DnsInspector';
import { DnsCachePanel } from './components/DnsCachePanel';
import { TcpStateInspector } from './components/TcpStateInspector';
import { HttpInspector } from './components/HttpInspector';
import { UrlBar } from './components/UrlBar';
import { JourneyPanel } from './components/JourneyPanel';
import { ProtocolStackView } from './components/ProtocolStackView';
import { LabProgress } from './components/LabProgress';
import { useLabProgress } from './state/progress';
import { selectedPacket } from './state/store';

export default function App() {
  const lab = useApp((s) => s.lab);
  const state = useApp((s) => s.state);
  const cursorMs = useApp((s) => s.cursorMs);
  const selectedPacketId = useApp((s) => s.selectedPacketId);
  const selectPacket = useApp((s) => s.selectPacket);
  const toggleLayer = useApp((s) => s.toggleLayer);
  const expandedLayers = useApp((s) => s.expandedLayers);
  const loadLab = useApp((s) => s.loadLab);
  const selectedEventIndex = useApp((s) => s.selectedEventIndex);
  const selectEvent = useApp((s) => s.selectEvent);

  const recordCompletion = useLabProgress((s) => s.recordCompletion);
  const markVisited = useLabProgress((s) => s.markVisited);

  const mode = useEditor((s) => s.mode);
  const enterEditor = useEditor((s) => s.enterEditor);
  const exitEditor = useEditor((s) => s.exitEditor);
  const topology = useEditor((s) => s.topology);
  const editorSelected = useEditor((s) => s.selectedNodeId);
  const pendingLinkFrom = useEditor((s) => s.pendingLinkFrom);
  const selectNode = useEditor((s) => s.select);

  useEffect(() => {
    if (useApp.getState().lab === null) {
      // The flagship scenario is the centerpiece: it opens by default.
      loadLab('open-web-page');
    }
  }, [loadLab]);

  // Keyboard instrument panel: Space plays/pauses, ←/→ step one event.
  // Typing targets and native buttons keep their own key behavior.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (target !== null) {
        const tag = target.tagName;
        if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || target.isContentEditable) return;
        if (tag === 'BUTTON' && (e.key === ' ' || e.key === 'Enter')) return;
      }
      const s = useApp.getState();
      if (s.state === null || s.selectedEventIndex !== null) return;
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        s.stepForward();
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        s.stepBackward();
      } else if (e.key === ' ') {
        e.preventDefault();
        s.togglePlay();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Client-side progress: a lab counts as visited once opened, and as
  // completed when the engine state satisfies its completion predicate.
  useEffect(() => {
    if (lab !== null) markVisited(lab.id);
  }, [lab, markVisited]);

  useEffect(() => {
    if (lab !== null && state !== null) recordCompletion(lab, state);
  }, [lab, state, recordCompletion]);

  const packet = selectedPacket(state, selectedPacketId);
  const editing = mode === 'editor';

  return (
    <div className="app-shell">
      <header className="app-header">
        <h1>
          Network Protocol <span className="accent">Visual Lab</span>
        </h1>
        <p className="tagline">Simulate · Inspect · Understand</p>
        <div className="mode-switch" role="group" aria-label="Application mode">
          <button
            className={!editing ? 'active' : ''}
            aria-pressed={!editing}
            onClick={exitEditor}
          >
            Labs
          </button>
          <button
            className={editing ? 'active' : ''}
            aria-pressed={editing}
            onClick={enterEditor}
          >
            Topology editor
          </button>
        </div>
      </header>

      <div className="app-body">
        <p className="sr-only">Keyboard: Space plays or pauses the simulation, arrow keys step one event at a time.</p>
        {!editing && (
          <aside className="sidebar">
            <LabNav />
            <LabProgress />
          </aside>
        )}

        <main className="main" id="main">
          {editing ? (
            <section className="stage" aria-label="Topology editor">
              {topology !== null && (
                <TopologyCanvas
                  topology={topology}
                  state={null}
                  cursorMs={0}
                  selectedPacketId={null}
                  onSelectPacket={() => undefined}
                  editorMode
                  selectedNodeId={editorSelected}
                  pendingLinkFrom={pendingLinkFrom}
                  onSelectNode={(id) => selectNode(id)}
                />
              )}
            </section>
          ) : (
            lab !== null && (
              <section className="stage" aria-label={`${lab.title} simulation`}>
                {lab.id === 'open-web-page' && <UrlBar />}
                <TopologyCanvas
                  topology={lab.topology}
                  state={state}
                  cursorMs={cursorMs}
                  selectedPacketId={selectedPacketId}
                  onSelectPacket={selectPacket}
                />
                <Controls />
                <Timeline />
                <ArpCachePanel />
                <RoutingTableInspector />
                <RouterDecisionPanel />
                {lab.id === 'open-web-page' && <JourneyPanel />}
                {lab.id === 'open-web-page' && <ProtocolStackView />}
                {lab.protocols.includes('DNS') && <DnsInspector />}
                {lab.protocols.includes('DNS') && <DnsCachePanel />}
                {lab.protocols.includes('TCP') && <TcpStateInspector />}
                {lab.protocols.includes('HTTP') && <HttpInspector />}
              </section>
            )
          )}
          {!editing && <LabDetail />}
        </main>

        <aside className="inspector-pane">
          {editing ? (
            <TopologyEditor />
          ) : selectedEventIndex !== null && state !== null ? (
            <div>
              <button className="copy-btn" onClick={() => selectEvent(null)}>
                ← Back to packet inspector
              </button>
              <EventInspector event={state.events[selectedEventIndex]} />
            </div>
          ) : (
            <PacketInspector packet={packet} expandedLayers={expandedLayers} onToggleLayer={toggleLayer} />
          )}
        </aside>
      </div>

      <StatusBar />
    </div>
  );
}
