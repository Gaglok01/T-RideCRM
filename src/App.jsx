// T‑Ride Check‑In / Check‑Out Webapp
// ------------------------------------------------------------
// Quick start:
// 1) Create a Firebase project → enable Authentication (Google) & Firestore.
// 2) Replace firebaseConfig below.
// 3) `npm create vite@latest tride-checkin -- --template react`
// 4) Add Tailwind (https://tailwindcss.com/docs/guides/vite) and this file as src/App.jsx
// 5) `npm install firebase date-fns`
// 6) `npm run dev` (or deploy on Vercel/Netlify)
// ------------------------------------------------------------

import { useEffect, useMemo, useRef, useState } from "react";
import { initializeApp } from "firebase/app";
import {
  getAuth,
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
} from "firebase/auth";
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getDocs,
  getFirestore,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
} from "firebase/firestore";
import { format, formatDuration, intervalToDuration } from "date-fns";

// ---------------------------
// 🔧 Firebase Config (replace)
// ---------------------------
const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID",
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

// Helpers
const todayKey = () => new Date().toISOString().slice(0, 10); // YYYY-MM-DD
const toTS = (d) => (d instanceof Timestamp ? d : Timestamp.fromDate(d));
const fromTS = (t) => (t instanceof Timestamp ? t.toDate() : t);

function cx(...classes) {
  return classes.filter(Boolean).join(" ");
}

function Card({ children, className = "" }) {
  return (
    <div className={cx("rounded-2xl border bg-white/70 backdrop-blur p-5 shadow-sm", className)}>
      {children}
    </div>
  );
}

function SectionTitle({ icon, title, right }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <div className="flex items-center gap-2 text-lg font-semibold">
        <span className="text-xl">{icon}</span>
        <span>{title}</span>
      </div>
      <div>{right}</div>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [task, setTask] = useState("");
  const [summary, setSummary] = useState("");
  const [activeLog, setActiveLog] = useState(null);
  const [teamLogs, setTeamLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [showAllDays, setShowAllDays] = useState(false);

  // Auth listener
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u || null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // Subscribe to active session for current user
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, "logs"),
      where("userId", "==", user.uid),
      where("end", "==", null),
      limit(1)
    );
    const unsub = onSnapshot(q, (snap) => {
      if (snap.empty) setActiveLog(null);
      else setActiveLog({ id: snap.docs[0].id, ...snap.docs[0].data() });
    });
    return () => unsub();
  }, [user]);

  // Subscribe to team logs (today or all)
  useEffect(() => {
    if (!user) return;
    const base = collection(db, "logs");
    const q = showAllDays
      ? query(base, orderBy("start", "desc"), limit(200))
      : query(base, where("dateKey", "==", todayKey()), orderBy("start", "desc"), limit(200));
    const unsub = onSnapshot(q, (snap) => {
      setTeamLogs(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
    return () => unsub();
  }, [user, showAllDays]);

  const provider = useMemo(() => new GoogleAuthProvider(), []);

  const doLogin = async () => {
    await signInWithPopup(auth, provider);
  };

  const doLogout = async () => {
    await signOut(auth);
  };

  const handleCheckIn = async () => {
    if (!user || !task.trim()) return;
    // Prevent multiple active logs per user
    if (activeLog) return;

    await addDoc(collection(db, "logs"), {
      userId: user.uid,
      userEmail: user.email,
      userName: user.displayName || "Anon",
      task: task.trim(),
      start: serverTimestamp(),
      end: null,
      summary: "",
      dateKey: todayKey(),
    });
    setTask("");
  };

  const handleCheckOut = async () => {
    if (!activeLog) return;
    const ref = doc(db, "logs", activeLog.id);
    await updateDoc(ref, {
      end: serverTimestamp(),
      summary: summary.trim(),
    });
    setSummary("");
  };

  const totalDuration = (start, end) => {
    const s = fromTS(start);
    const e = end ? fromTS(end) : new Date();
    const dur = intervalToDuration({ start: s, end: e });
    return formatDuration(dur, { format: ["hours", "minutes", "seconds"] }) || "0s";
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return teamLogs;
    return teamLogs.filter((l) =>
      [l.userName, l.userEmail, l.task, l.summary]
        .filter(Boolean)
        .some((v) => v.toLowerCase().includes(q))
    );
  }, [teamLogs, search]);

  const exportCSV = () => {
    const rows = [
      ["dateKey", "userName", "userEmail", "task", "start", "end", "duration", "summary"],
      ...filtered.map((l) => {
        const s = fromTS(l.start)?.toISOString?.() ?? "";
        const e = l.end ? fromTS(l.end)?.toISOString?.() : "";
        const dur = totalDuration(l.start, l.end);
        return [l.dateKey, l.userName, l.userEmail, l.task || "", s, e, dur, (l.summary || "").replace(/\n/g, " ")];
      }),
    ];
    const csv = rows.map((r) => r.map((c) => `"${String(c).replaceAll('"', '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tride_logs_${todayKey()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Live ticking for active timer
  const [, forceTick] = useState(0);
  useEffect(() => {
    if (!activeLog) return;
    const id = setInterval(() => forceTick((x) => x + 1), 1000);
    return () => clearInterval(id);
  }, [activeLog]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-yellow-50 via-white to-amber-50 text-slate-800">
      <header className="border-b bg-white/60 backdrop-blur sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-400 grid place-items-center font-black">T</div>
            <div className="font-bold tracking-tight">T‑Ride • Check‑In / Check‑Out</div>
          </div>
          <div className="flex items-center gap-3">
            {user ? (
              <>
                <span className="text-sm hidden sm:inline">{user.displayName}</span>
                <button onClick={doLogout} className="px-3 py-1.5 rounded-lg border hover:bg-white">Logout</button>
              </>
            ) : (
              <button onClick={doLogin} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Login with Google</button>
            )}
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: My panel */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <SectionTitle icon="🧭" title="Mon statut" />
            {user ? (
              <>
                {!activeLog ? (
                  <div className="space-y-3">
                    <label className="text-sm font-medium">Que vas‑tu faire ?</label>
                    <input
                      className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400"
                      placeholder="Ex: Revue GovWin, build Android, mise à jour Firebase…"
                      value={task}
                      onChange={(e) => setTask(e.target.value)}
                    />
                    <button
                      onClick={handleCheckIn}
                      disabled={!task.trim()}
                      className={cx(
                        "w-full rounded-xl px-4 py-2 font-semibold",
                        task.trim()
                          ? "bg-amber-500 text-white hover:bg-amber-600"
                          : "bg-amber-200 text-amber-700 cursor-not-allowed"
                      )}
                    >
                      ✅ Check‑In
                    </button>
                    <p className="text-xs text-slate-500">Un seul check‑in actif à la fois.</p>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-slate-500">Tâche en cours</div>
                        <div className="font-medium">{activeLog.task}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-sm text-slate-500">Démarré</div>
                        <div className="font-medium">{fromTS(activeLog.start)?.toLocaleTimeString?.() || "—"}</div>
                      </div>
                    </div>
                    <div className="rounded-xl bg-amber-50 border px-3 py-2 text-sm">⏱️ Durée: {totalDuration(activeLog.start, null)}</div>
                    <label className="text-sm font-medium">Résumé / faits clés</label>
                    <textarea
                      className="w-full rounded-xl border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-amber-400 min-h-[100px]"
                      placeholder="Ex: Corrigé le bug de build, mis à jour rules Firestore, optimisé UI Check‑Out…"
                      value={summary}
                      onChange={(e) => setSummary(e.target.value)}
                    />
                    <button
                      onClick={handleCheckOut}
                      className="w-full rounded-xl px-4 py-2 font-semibold bg-emerald-600 text-white hover:bg-emerald-700"
                    >
                      🏁 Check‑Out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <p className="text-slate-600">Connecte‑toi pour enregistrer ton temps.</p>
            )}
          </Card>

          <Card>
            <SectionTitle icon="📌" title="Conseils d’usage" />
            <ul className="list-disc pl-5 space-y-1 text-sm text-slate-600">
              <li>Une tâche = un check‑in. Fais un check‑out avant de démarrer une nouvelle tâche.</li>
              <li>Le résumé sert au reporting hebdo (GovWin / SAM.gov / Apps / Web).</li>
              <li>Utilise des verbes d’action : “corrigé, déployé, vérifié, rédigé, testé…”.</li>
            </ul>
          </Card>
        </div>

        {/* Right column: Team dashboard */}
        <div className="lg:col-span-2 space-y-6">
          <Card>
            <SectionTitle
              icon="🧑‍🤝‍🧑"
              title="Tableau d’équipe"
              right={
                <div className="flex items-center gap-2">
                  <input
                    className="rounded-lg border px-3 py-1.5 text-sm"
                    placeholder="Recherche (nom, email, tâche, résumé)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <button
                    onClick={() => setShowAllDays((v) => !v)}
                    className="px-3 py-1.5 rounded-lg border hover:bg-white text-sm"
                  >
                    {showAllDays ? "Afficher: Aujourd’hui" : "Afficher: Tous"}
                  </button>
                  <button onClick={exportCSV} className="px-3 py-1.5 rounded-lg bg-slate-900 text-white text-sm hover:bg-black">Exporter CSV</button>
                </div>
              }
            />

            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-slate-50">
                    <th className="py-2 px-3">Utilisateur</th>
                    <th className="py-2 px-3">Tâche</th>
                    <th className="py-2 px-3">Début</th>
                    <th className="py-2 px-3">Fin</th>
                    <th className="py-2 px-3">Durée</th>
                    <th className="py-2 px-3">Résumé</th>
                    <th className="py-2 px-3">Statut</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((l) => {
                    const s = fromTS(l.start);
                    const e = l.end ? fromTS(l.end) : null;
                    const status = e ? "Terminé" : "Actif";
                    return (
                      <tr key={l.id} className="border-b last:border-0 hover:bg-amber-50/40">
                        <td className="py-2 px-3">
                          <div className="font-medium">{l.userName || "—"}</div>
                          <div className="text-xs text-slate-500">{l.userEmail}</div>
                        </td>
                        <td className="py-2 px-3 max-w-[250px]"><div className="truncate" title={l.task}>{l.task}</div></td>
                        <td className="py-2 px-3 whitespace-nowrap">{s ? format(s, "PPpp") : "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{e ? format(e, "PPpp") : "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{totalDuration(l.start, l.end)}</td>
                        <td className="py-2 px-3 max-w-[300px]"><div className="truncate" title={l.summary}>{l.summary || "—"}</div></td>
                        <td className="py-2 px-3">
                          <span className={cx(
                            "px-2 py-1 rounded-lg text-xs",
                            e ? "bg-emerald-100 text-emerald-700" : "bg-amber-100 text-amber-700"
                          )}>{status}</span>
                        </td>
                      </tr>
                    );
                  })}
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-slate-500">Aucune entrée.</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <SectionTitle icon="🛡️" title="Règles Firestore (sécurité)" />
            <pre className="text-xs bg-slate-50 p-3 rounded-xl overflow-auto">
{`// Firestore security rules (console > Firestore > Rules)
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /logs/{logId} {
      allow read: if request.auth != null; // team-only (requires login)
      // Create: only self
      allow create: if request.auth != null
        && request.resource.data.userId == request.auth.uid;
      // Update: only owner of the log
      allow update: if request.auth != null
        && resource.data.userId == request.auth.uid;
      // Delete: allow only owner (optional)
      allow delete: if request.auth != null
        && resource.data.userId == request.auth.uid;
    }
  }
}`}
            </pre>
          </Card>
        </div>
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">© {new Date().getFullYear()} T‑Ride</footer>
    </div>
  );
}
