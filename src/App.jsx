// T‑Ride Check‑In / Check‑Out — Polished UI (React + Firebase + Tailwind v4)
// Features: Google login • Check‑In/Out • Quick tags • Live notes • Team dashboard • Weekly CSV

import { useEffect, useMemo, useState } from "react";
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from "firebase/auth";
import {
  getFirestore,
  collection,
  addDoc,
  getDocs,
  query,
  where,
  orderBy,
  updateDoc,
  doc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";
import { format, startOfDay, addDays, startOfWeek, endOfWeek, differenceInSeconds, isValid as isValidDate } from "date-fns";

// 🔑 Firebase config (your values)
const firebaseConfig = {
  apiKey: "AIzaSyBPJOAj4FH7Xdqc2mXrlKVaBsu0DajTwDc",
  authDomain: "t-ride-crm.firebaseapp.com",
  projectId: "t-ride-crm",
  storageBucket: "t-ride-crm.appspot.com",
  messagingSenderId: "798112076985",
  appId: "1:798112076985:web:b1b349634f7d8595ef7768",
};

// Firebase
const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);
const provider = new GoogleAuthProvider();

// Helpers
const ts = (v) => (v?.toDate ? v.toDate() : v instanceof Date ? v : null);
const fmtHM = (secs) => {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
};
const urlify = (t) => (t.match(/\b(https?:\/\/[^\s)]+|www\.[^\s)]+)/gi) || []).map((u) => (u.startsWith("http") ? u : `https://${u}`));

// UI atoms
const Card = ({ children, className = "" }) => (
  <div className={`rounded-2xl border border-slate-200 bg-white/80 backdrop-blur p-5 shadow-sm ${className}`}>{children}</div>
);
const Pill = ({ children, active = false, onClick }) => (
  <button onClick={onClick} className={`px-2 py-1 rounded-xl text-xs border transition ${active ? "bg-amber-500 border-amber-500 text-white" : "bg-white hover:bg-slate-50 border-slate-200 text-slate-700"}`}>{children}</button>
);
const Badge = ({ children }) => (
  <span className="inline-block px-2 py-0.5 rounded-lg text-xs bg-amber-100 text-amber-700 border border-amber-200">{children}</span>
);

const TAGS = ["GovWin", "SAM.gov", "Android", "Website"];

export default function App() {
  const [user, setUser] = useState(null);

  // session
  const [task, setTask] = useState("");
  const [noteAtStart, setNoteAtStart] = useState("");
  const [chosenTags, setChosenTags] = useState([]);
  const [customTag, setCustomTag] = useState("");
  const [activeLog, setActiveLog] = useState(null);
  const [summary, setSummary] = useState("");

  // live notes
  const [noteText, setNoteText] = useState("");
  const [activeNotes, setActiveNotes] = useState([]);

  // data
  const [myLogs, setMyLogs] = useState([]);
  const [todayTotals, setTodayTotals] = useState([]);
  const [teamTotalSecs, setTeamTotalSecs] = useState(0);
  const [teamLogs, setTeamLogs] = useState([]);
  const [search, setSearch] = useState("");
  const [filterTag, setFilterTag] = useState("All");

  // auth listener
  useEffect(() => {
    return onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        await loadMyLogs(u.uid);
        await loadTodaySummary();
        subscribeTodayTeamLogs();
      } else {
        setMyLogs([]);
        setActiveLog(null);
        setTodayTotals([]);
        setTeamTotalSecs(0);
        setTeamLogs([]);
      }
    });
  }, []);

  // subscribe to notes for running log
  useEffect(() => {
    if (!activeLog) return setActiveNotes([]);
    const unsub = onSnapshot(query(collection(db, "logs", activeLog.id, "notes"), orderBy("createdAt", "asc")), (snap) => setActiveNotes(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    return () => unsub();
  }, [activeLog]);

  // queries
  const loadMyLogs = async (uid) => {
    const q1 = query(collection(db, "logs"), where("uid", "==", uid), orderBy("start", "desc"));
    const snap = await getDocs(q1);
    const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    setMyLogs(rows);
    const running = rows.find((r) => !r.end);
    setActiveLog(running || null);
  };

  const loadTodaySummary = async () => {
    const start = startOfDay(new Date());
    const end = addDays(start, 1);
    const q2 = query(collection(db, "logs"), where("start", ">=", start), where("start", "<", end), orderBy("start", "desc"));
    const snap = await getDocs(q2);

    const perUser = new Map();
    let teamSecs = 0;
    const logs = [];

    snap.forEach((docSnap) => {
      const data = { id: docSnap.id, ...docSnap.data() };
      const s = ts(data.start);
      const e = ts(data.end) || new Date();
      if (!isValidDate(s) || !isValidDate(e)) return;
      const secs = Math.max(0, differenceInSeconds(e, s));
      teamSecs += secs;
      const prev = perUser.get(data.uid) || { name: data.name || "—", seconds: 0 };
      prev.seconds += secs;
      perUser.set(data.uid, prev);
      logs.push(data);
    });

    const rows = Array.from(perUser.entries()).map(([uid, v]) => ({ uid, name: v.name, seconds: v.seconds }));
    rows.sort((a, b) => b.seconds - a.seconds);
    setTodayTotals(rows);
    setTeamTotalSecs(teamSecs);
    setTeamLogs(logs);
  };

  const subscribeTodayTeamLogs = () => {
    const start = startOfDay(new Date());
    const end = addDays(start, 1);
    const q3 = query(collection(db, "logs"), where("start", ">=", start), where("start", "<", end), orderBy("start", "desc"));
    return onSnapshot(q3, () => loadTodaySummary());
  };

  // actions
  const toggleTag = (t) => setChosenTags((prev) => (prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]));
  const addCustomTag = () => {
    const t = customTag.trim();
    if (!t) return;
    setChosenTags((prev) => (prev.includes(t) ? prev : [...prev, t]));
    setCustomTag("");
  };

  const handleCheckIn = async () => {
    if (!task.trim()) return;
    const ref = await addDoc(collection(db, "logs"), {
      uid: user.uid,
      name: user.displayName || "—",
      task: task.trim(),
      noteAtStart: noteAtStart.trim(),
      tags: chosenTags,
      start: serverTimestamp(),
      end: null,
      summary: "",
    });
    setTask("");
    setNoteAtStart("");
    setChosenTags([]);
    setActiveLog({ id: ref.id, task, start: new Date(), tags: chosenTags });
    setTimeout(() => { loadMyLogs(user.uid); loadTodaySummary(); }, 600);
  };

  const handleAddNote = async () => {
    if (!activeLog || !noteText.trim()) return;
    const links = urlify(noteText);
    await addDoc(collection(db, "logs", activeLog.id, "notes"), { text: noteText.trim(), links, createdAt: serverTimestamp(), uid: user.uid, name: user.displayName || "—" });
    setNoteText("");
  };

  const handleAddTagDuringSession = async (t) => {
    if (!activeLog) return;
    const newTags = Array.from(new Set([...(activeLog.tags || []), t]));
    await updateDoc(doc(db, "logs", activeLog.id), { tags: newTags });
    setActiveLog({ ...activeLog, tags: newTags });
  };

  const handleCheckOut = async () => {
    if (!activeLog) return;
    await updateDoc(doc(db, "logs", activeLog.id), { end: serverTimestamp(), summary: summary.trim() });
    setSummary("");
    setActiveLog(null);
    setTimeout(() => { if (user) loadMyLogs(user.uid); loadTodaySummary(); }, 600);
  };

  // filters
  const filteredTeamLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return teamLogs
      .filter((l) => (filterTag === "All" ? true : (l.tags || []).includes(filterTag)))
      .filter((l) => !q ? true : [l.name, l.task, l.summary, ...(l.tags || [])].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((a, b) => (ts(b.start) || 0) - (ts(a.start) || 0));
  }, [teamLogs, search, filterTag]);

  // weekly export
  const exportWeeklyCSV = async () => {
    const start = startOfWeek(new Date(), { weekStartsOn: 1 });
    const end = endOfWeek(new Date(), { weekStartsOn: 1 });
    const q4 = query(collection(db, "logs"), where("start", ">=", start), where("start", "<=", end), orderBy("start", "asc"));
    const snap = await getDocs(q4);
    const perUser = new Map();
    snap.forEach((d) => {
      const row = d.data();
      const s = ts(row.start);
      const e = ts(row.end) || new Date();
      if (!isValidDate(s) || !isValidDate(e)) return;
      const secs = Math.max(0, differenceInSeconds(e, s));
      const cur = perUser.get(row.uid) || { name: row.name || "—", seconds: 0 };
      cur.seconds += secs;
      perUser.set(row.uid, cur);
    });
    const rows = [["User", "Hours", "Minutes"]];
    perUser.forEach((v) => { const h = Math.floor(v.seconds / 3600); const m = Math.floor((v.seconds % 3600) / 60); rows.push([v.name, h, m]); });
    const csv = rows.map((r) => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tride_weekly_${format(start, "yyyyMMdd")}_${format(end, "yyyyMMdd")}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-amber-50 via-white to-amber-100/40 text-slate-800">
      {/* Header */}
      <header className="sticky top-0 z-20 border-b bg-white/70 backdrop-blur">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-amber-400 grid place-items-center font-black">T</div>
            <div className="font-bold tracking-tight text-lg">T‑Ride • Team Time</div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={exportWeeklyCSV} className="px-3 py-1.5 rounded-lg border hover:bg-white text-sm">⬇️ Weekly CSV</button>
            {!user ? (
              <button onClick={() => signInWithPopup(auth, provider)} className="px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600">Login with Google</button>
            ) : (
              <>
                <span className="text-sm hidden sm:inline">{user.displayName}</span>
                <button onClick={() => signOut(auth)} className="px-3 py-1.5 rounded-lg border hover:bg-white">Logout</button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Body */}
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: My panel */}
        <section className="lg:col-span-1 space-y-6">
          <Card>
            <h2 className="text-lg font-semibold mb-3">Mon statut</h2>
            {!user ? (
              <p className="text-sm text-slate-600">Connecte‑toi pour enregistrer ton temps.</p>
            ) : !activeLog ? (
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-medium">Tâche</label>
                  <input className="w-full rounded-xl border px-3 py-2" placeholder="Ex: Build Android, Revue GovWin, SAM.gov…" value={task} onChange={(e) => setTask(e.target.value)} />
                </div>
                <div>
                  <label className="text-sm font-medium">Note (optionnel)</label>
                  <input className="w-full rounded-xl border px-3 py-2" placeholder="Objectif, lien de ticket, etc." value={noteAtStart} onChange={(e) => setNoteAtStart(e.target.value)} />
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Tags rapides</div>
                  <div className="flex flex-wrap gap-2">
                    {TAGS.map((t) => (
                      <Pill key={t} active={chosenTags.includes(t)} onClick={() => toggleTag(t)}>#{t}</Pill>
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <input className="flex-1 rounded-lg border px-3 py-1.5 text-sm" placeholder="Tag perso (ex: iOS, Backend)" value={customTag} onChange={(e) => setCustomTag(e.target.value)} />
                    <button onClick={addCustomTag} className="px-3 py-1.5 rounded-lg border hover:bg-white text-sm">+ Ajouter</button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {chosenTags.map((t) => (
                      <Badge key={t}>#{t}</Badge>
                    ))}
                  </div>
                </div>
                <button onClick={handleCheckIn} disabled={!task.trim()} className={`w-full rounded-xl px-4 py-2 font-semibold ${task.trim() ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-amber-200 text-amber-700 cursor-not-allowed"}`}>✅ Check‑In</button>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <div className="text-sm text-slate-600">Tâche en cours</div>
                  <div className="font-medium">{activeLog.task || "—"}</div>
                  <div className="mt-2 flex flex-wrap gap-2">{(activeLog.tags || []).map((t) => (<Badge key={t}>#{t}</Badge>))}</div>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Ajouter une note / lien</div>
                  <textarea className="w-full rounded-xl border px-3 py-2 min-h-[80px]" placeholder="Ex: Corrigé l'erreur de build. Lien: https://…" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
                  <div className="flex items-center gap-2">
                    <button onClick={handleAddNote} disabled={!noteText.trim()} className={`rounded-xl px-4 py-2 font-semibold ${noteText.trim() ? "bg-sky-600 text-white hover:bg-sky-700" : "bg-sky-200 text-sky-700 cursor-not-allowed"}`}>➕ Ajouter la note</button>
                    <div className="flex gap-2">{TAGS.map((t) => (<Pill key={t} onClick={() => handleAddTagDuringSession(t)}>+ #{t}</Pill>))}</div>
                  </div>
                  <ul className="space-y-2">
                    {activeNotes.map((n) => (
                      <li key={n.id} className="bg-slate-50 border rounded-xl p-3">
                        <div>{n.text}</div>
                        {n.links?.length > 0 && (
                          <div className="mt-1 text-sm">{n.links.map((u, i) => (
                            <a key={i} href={u} target="_blank" rel="noreferrer" className="underline text-sky-600 mr-2 break-all">{u}</a>
                          ))}</div>
                        )}
                      </li>
                    ))}
                    {activeNotes.length === 0 && <li className="text-slate-500 text-sm">Aucune note pour l’instant.</li>}
                  </ul>
                </div>
                <div className="space-y-2">
                  <div className="text-sm font-medium">Résumé de fin</div>
                  <textarea className="w-full rounded-xl border px-3 py-2 min-h-[80px]" placeholder="Ce que tu as accompli" value={summary} onChange={(e) => setSummary(e.target.value)} />
                  <button onClick={handleCheckOut} className="w-full rounded-xl px-4 py-2 font-semibold bg-emerald-600 text-white hover:bg-emerald-700">🏁 Check‑Out</button>
                </div>
              </div>
            )}
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-3">Mes logs</h2>
            <ul className="space-y-2">
              {myLogs.map((log) => {
                const s = ts(log.start);
                const e = ts(log.end);
                return (
                  <li key={log.id} className="border p-3 rounded-xl bg-slate-50">
                    <div className="font-medium">{s ? format(s, "PPpp") : "—"} → {e ? format(e, "PPpp") : "⏳ en cours"}</div>
                    {log.task && <div className="text-sm text-slate-600">Tâche: {log.task}</div>}
                    {Array.isArray(log.tags) && log.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-2">{log.tags.map((t) => (<Badge key={t}>#{t}</Badge>))}</div>}
                    {log.noteAtStart && <div className="text-xs text-slate-500 mt-1">Note: {log.noteAtStart}</div>}
                    {log.summary && <div className="text-sm italic mt-1">{log.summary}</div>}
                  </li>
                );
              })}
              {myLogs.length === 0 && <li className="text-slate-500 text-sm">Aucun log.</li>}
            </ul>
          </Card>
        </section>

        {/* Right column: Team dashboard */}
        <section className="lg:col-span-2 space-y-6">
          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold">📊 Today summary (équipe)</h2>
              <div className="text-sm">Total équipe: <span className="font-semibold">{fmtHM(teamTotalSecs)}</span></div>
            </div>
            {todayTotals.length === 0 ? (
              <p className="text-sm text-slate-600">Aucune donnée aujourd’hui (encore 😉).</p>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-slate-50"><th className="py-2 px-3">Utilisateur</th><th className="py-2 px-3">Temps total</th></tr>
                </thead>
                <tbody>
                  {todayTotals.map((r) => (<tr key={r.uid} className="border-b last:border-0"><td className="py-2 px-3">{r.name}</td><td className="py-2 px-3">{fmtHM(r.seconds)}</td></tr>))}
                </tbody>
              </table>
            )}
          </Card>

          <Card>
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h2 className="text-lg font-semibold">🧑‍🤝‍🧑 Today logs (équipe)</h2>
              <div className="flex items-center gap-2">
                <input className="rounded-lg border px-3 py-1.5 text-sm" placeholder="Recherche (nom, tâche, résumé, tag)" value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="rounded-lg border px-3 py-1.5 text-sm" value={filterTag} onChange={(e) => setFilterTag(e.target.value)}>
                  <option>All</option>
                  {[...new Set(teamLogs.flatMap((l) => l.tags || []))].map((t) => (<option key={t}>{t}</option>))}
                </select>
              </div>
            </div>
            <div className="overflow-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left border-b bg-slate-50"><th className="py-2 px-3">Utilisateur</th><th className="py-2 px-3">Tâche</th><th className="py-2 px-3">Tags</th><th className="py-2 px-3">Début</th><th className="py-2 px-3">Fin</th><th className="py-2 px-3">Durée</th><th className="py-2 px-3">Résumé</th></tr>
                </thead>
                <tbody>
                  {filteredTeamLogs.map((l) => {
                    const s = ts(l.start);
                    const e = ts(l.end);
                    const secs = Math.max(0, differenceInSeconds(e || new Date(), s || new Date()));
                    return (
                      <tr key={l.id} className="border-b last:border-0">
                        <td className="py-2 px-3">{l.name || "—"}</td>
                        <td className="py-2 px-3">{l.task || "—"}</td>
                        <td className="py-2 px-3"><div className="flex flex-wrap gap-1">{(l.tags || []).map((t) => (<Badge key={t}>#{t}</Badge>))}</div></td>
                        <td className="py-2 px-3 whitespace-nowrap">{s ? format(s, "PPpp") : "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{e ? format(e, "PPpp") : "—"}</td>
                        <td className="py-2 px-3 whitespace-nowrap">{fmtHM(secs)}</td>
                        <td className="py-2 px-3 max-w-[320px]"><div className="truncate" title={l.summary || ""}>{l.summary || "—"}</div></td>
                      </tr>
                    );
                  })}
                  {filteredTeamLogs.length === 0 && (<tr><td colSpan={7} className="py-6 text-center text-slate-500">Aucun log pour ce filtre.</td></tr>)}
                </tbody>
              </table>
            </div>
          </Card>

          <Card>
            <h2 className="text-lg font-semibold mb-2">ℹ️ Conseils</h2>
            <ul className="list-disc pl-5 text-sm text-slate-600 space-y-1">
              <li>Utilise les <b>tags</b> pour filtrer et faire des rapports en 1 clic.</li>
              <li>Le bouton <b>Weekly CSV</b> exporte les totaux par personne (semaine en cours).</li>
              <li>Si Firestore demande un index, clique le lien proposé puis recharge.</li>
            </ul>
          </Card>
        </section>
      </main>

      <footer className="text-center text-xs text-slate-500 py-6">© {new Date().getFullYear()} T‑Ride</footer>
    </div>
  );
}
