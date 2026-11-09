import * as Y from "yjs";
import type { Server, Socket } from "socket.io";
import type { PrismaClient } from "./generated/prisma/client.js";

type TeamSocketUser = { id: string; role: string; teamId: string | null };
type CodingDocument = { doc: Y.Doc; text: Y.Text; revision: number; persistChain: Promise<void> };
type Ack = (result: { ok: boolean; error?: string; starterUpdated?: boolean }) => void;

const documents = new Map<string, Promise<CodingDocument>>();
const templates: Record<string, string> = {
  PYTHON: "import sys\n\ndef solve():\n    data = sys.stdin.read().strip().split()\n    # Write your solution here\n    print()\n\nif __name__ == '__main__':\n    solve()\n",
  JAVA: "import java.io.*;\nimport java.util.*;\n\npublic class Main {\n    public static void main(String[] args) throws Exception {\n        Scanner in = new Scanner(System.in);\n        // Write your solution here\n    }\n}\n",
  C: "#include <stdio.h>\n\nint main(void) {\n    // Write your solution here\n    return 0;\n}\n",
  CPP: "#include <bits/stdc++.h>\nusing namespace std;\n\nint main() {\n    ios::sync_with_stdio(false);\n    cin.tie(nullptr);\n    // Write your solution here\n    return 0;\n}\n",
};
const room = (sessionId: string) => `coding:${sessionId}`;
const isStarterCode = (source: string) => source.length === 0 || Object.values(templates).includes(source);

function asUpdate(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value) && value.every((byte) => Number.isInteger(byte) && byte >= 0 && byte <= 255)) return Uint8Array.from(value);
  return null;
}

export function createCodingCollaboration(io: Server, prisma: PrismaClient) {
  async function loadDocument(sessionId: string): Promise<CodingDocument> {
    const session = await prisma.codingSession.findUnique({ where: { id: sessionId }, select: { savedCode: true, collabState: true, language: true, revision: true } });
    if (!session) throw new Error("Coding session not found");
    const doc = new Y.Doc();
    const text = doc.getText("source");
    let persistInitialDocument = false;
    if (session.collabState) {
      Y.applyUpdate(doc, Buffer.from(session.collabState, "base64"));
      // Older sessions can contain an encoded but empty Y.Doc. Recover the
      // saved source, or the selected language's starter, before joining.
      if (text.length === 0) {
        const initialCode = session.savedCode || templates[session.language] || templates.PYTHON;
        if (initialCode) text.insert(0, initialCode);
        persistInitialDocument = true;
      }
    } else {
      const initialCode = session.savedCode || templates[session.language] || templates.PYTHON;
      if (initialCode) text.insert(0, initialCode);
      persistInitialDocument = true;
    }
    if (persistInitialDocument) {
      const collabState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
      await prisma.codingSession.update({ where: { id: sessionId }, data: { savedCode: text.toString(), collabState } });
    }

    const state: CodingDocument = { doc, text, revision: session.revision, persistChain: Promise.resolve() };
    doc.on("update", (update, origin) => {
      const updateBuffer = Buffer.from(update);
      const savedCode = text.toString();
      const collabState = Buffer.from(Y.encodeStateAsUpdate(doc)).toString("base64");
      state.persistChain = state.persistChain.then(async () => {
        const persisted = await prisma.codingSession.updateMany({
          where: { id: sessionId, endedAt: null, deadlineAt: { gt: new Date() } },
          data: { savedCode, collabState, revision: { increment: 1 } },
        });
        if (persisted.count !== 1) {
          io.to(room(sessionId)).emit("coding:locked", { sessionId, error: "This coding session has expired" });
          return;
        }
        const current = await prisma.codingSession.findUnique({ where: { id: sessionId }, select: { revision: true } });
        if (current) state.revision = current.revision;
        if (typeof origin === "string") io.to(room(sessionId)).except(origin).emit("coding:update", { sessionId, update: updateBuffer });
        else io.to(room(sessionId)).emit("coding:update", { sessionId, update: updateBuffer });
        io.to(room(sessionId)).emit("coding:saved", { sessionId, revision: current?.revision ?? state.revision + 1 });
      }).catch((error) => {
        console.error("coding_collaboration_persist_failed", { sessionId, error });
        io.to(room(sessionId)).emit("coding:error", { sessionId, error: "Could not save the shared code. Keep this page open and retry." });
      });
    });
    return state;
  }

  function getDocument(sessionId: string) {
    let pending = documents.get(sessionId);
    if (!pending) {
      pending = loadDocument(sessionId).catch((error) => {
        documents.delete(sessionId);
        throw error;
      });
      documents.set(sessionId, pending);
    }
    return pending;
  }

  async function announcePresence(sessionId: string) {
    const sockets = await io.in(room(sessionId)).fetchSockets();
    const members = [...new Set(sockets.map((socket) => (socket.data.user as TeamSocketUser).id))];
    io.to(room(sessionId)).emit("coding:presence", { sessionId, members });
  }

  function attach(socket: Socket, user: TeamSocketUser) {
    if (user.role !== "TEAM" || !user.teamId) return;
    const teamId = user.teamId;
    const joined = new Set<string>();

    socket.on("coding:join", async (requestedSessionId: unknown, ack?: Ack) => {
      try {
        if (typeof requestedSessionId !== "string" || requestedSessionId.length > 100) return ack?.({ ok: false, error: "Invalid coding session" });
        const session = await prisma.codingSession.findFirst({ where: { id: requestedSessionId, teamId }, select: { id: true, language: true, deadlineAt: true, endedAt: true, revision: true } });
        if (!session) return ack?.({ ok: false, error: "Coding session not found for this team" });
        if (session.endedAt || session.deadlineAt <= new Date()) return ack?.({ ok: false, error: "This coding session has expired" });
        const state = await getDocument(session.id);
        await socket.join(room(session.id));
        joined.add(session.id);
        socket.emit("coding:sync", { sessionId: session.id, update: Y.encodeStateAsUpdate(state.doc), language: session.language, revision: state.revision, deadlineAt: session.deadlineAt.toISOString(), serverNow: Date.now() });
        ack?.({ ok: true });
        void announcePresence(session.id).catch((error) => console.error("coding_presence_failed", error));
      } catch (error) {
        console.error("coding_join_failed", error);
        ack?.({ ok: false, error: "Could not join the shared coding session" });
      }
    });

    socket.on("coding:update", async (payload: { sessionId?: unknown; update?: unknown }, ack?: Ack) => {
      const sessionId = payload?.sessionId;
      if (typeof sessionId !== "string" || !joined.has(sessionId)) return ack?.({ ok: false, error: "Join the team coding session before editing" });
      const update = asUpdate(payload.update);
      if (!update || update.byteLength > 128 * 1024) return ack?.({ ok: false, error: "Invalid or oversized editor update" });
      try {
        const state = await getDocument(sessionId);
        Y.applyUpdate(state.doc, update, socket.id);
        ack?.({ ok: true });
      } catch (error) {
        console.error("coding_update_failed", { sessionId, error });
        ack?.({ ok: false, error: "Could not apply the shared editor update" });
      }
    });

    socket.on("coding:language", async (payload: { sessionId?: unknown; language?: unknown }, ack?: Ack) => {
      const sessionId = payload?.sessionId;
      const language = payload?.language;
      if (typeof sessionId !== "string" || !joined.has(sessionId) || typeof language !== "string" || !Object.hasOwn(templates, language)) return ack?.({ ok: false, error: "Invalid language change" });
      try {
        const activeSession = await prisma.codingSession.findFirst({ where: { id: sessionId, teamId, endedAt: null, deadlineAt: { gt: new Date() } }, select: { id: true } });
        if (!activeSession) return ack?.({ ok: false, error: "This coding session has expired" });
        const state = await getDocument(sessionId);
        let starterUpdated = false;
        if (isStarterCode(state.text.toString())) {
          state.doc.transact(() => {
            // Recheck inside the transaction so a teammate's new code is never overwritten.
            if (!isStarterCode(state.text.toString())) return;
            const currentLength = state.text.length;
            if (currentLength > 0) state.text.delete(0, currentLength);
            state.text.insert(0, templates[language]);
            starterUpdated = true;
          }, socket.id);
          if (starterUpdated) await state.persistChain;
        }
        const saved = await prisma.codingSession.updateMany({ where: { id: sessionId, teamId, endedAt: null, deadlineAt: { gt: new Date() } }, data: { language, revision: { increment: 1 } } });
        if (saved.count !== 1) return ack?.({ ok: false, error: "This coding session has expired" });
        const current = await prisma.codingSession.findUnique({ where: { id: sessionId }, select: { revision: true } });
        // The document update normally excludes its author to avoid echoing
        // every keystroke. Language changes are server-authored, so send the
        // starter template back to the member who requested the change.
        if (starterUpdated) socket.emit("coding:update", { sessionId, update: Y.encodeStateAsUpdate(state.doc) });
        io.to(room(sessionId)).emit("coding:language.updated", { sessionId, language, revision: current?.revision ?? 0 });
        ack?.({ ok: true, starterUpdated });
      } catch (error) {
        console.error("coding_language_update_failed", { sessionId, error });
        ack?.({ ok: false, error: "Could not save the team language" });
      }
    });

    socket.on("disconnect", () => {
      for (const sessionId of joined) void announcePresence(sessionId).catch((error) => console.error("coding_presence_failed", error));
    });
  }

  return {
    attach,
    async resetSessions(sessionIds: string[]) {
      for (const sessionId of sessionIds) {
        const pending = documents.get(sessionId);
        if (pending) {
          const state = await pending;
          await state.persistChain;
          documents.delete(sessionId);
          state.doc.destroy();
        }
        io.to(room(sessionId)).emit("coding:history.reset", { sessionId, message: "The administrator reset this algorithm’s code history. Your team can start it again from My Allotments." });
      }
    },
    async flush() {
      const states = await Promise.all([...documents.values()]);
      await Promise.all(states.map((state) => state.persistChain));
    },
  };
}
