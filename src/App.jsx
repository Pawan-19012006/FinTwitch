// src/App.jsx
import { db, auth } from "./firebase";
import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import React, { useState, useEffect, createContext, useContext, useRef } from "react";
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Link,
  useNavigate,
  useLocation,
  Outlet
} from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import axios from "axios";

/* 🌟 FinTwitch — Gamified Finance Prototype
   Features:
   - Games (Quiz, Scenario, Portfolio)
   - Tools (FIRE, Tax, Return)
   - Articles (Rewards)
   - Habit Tracker (Streak)
   - Transactions History
   - Firebase Sync + LocalStorage
   - Animated Balance + Toast Notifications
*/

// -------------------- Utility Helpers --------------------
const todayStr = () => new Date().toISOString().slice(0, 10);
const yesterdayStr = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
};
const round2 = (n) => Math.round(n * 100) / 100;
const fmt = (n) => `₹${round2(n).toFixed(2)}`;

// Contexts
const UserContext = createContext(null);
const ToastContext = createContext(null);

// -------------------- Animated Balance --------------------
function AnimatedBalance({ value }) {
  const [display, setDisplay] = useState(value);
  const rafRef = useRef(null);

  useEffect(() => {
    const start = display;
    const end = value;
    const dur = 400;
    const startTime = performance.now();
    if (rafRef.current) cancelAnimationFrame(rafRef.current);

    const step = (now) => {
      const t = Math.min(1, (now - startTime) / dur);
      const eased = 1 - Math.pow(1 - t, 3);
      const v = start + (end - start) * eased;
      setDisplay(round2(v));
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [value]);

  return <div className="font-semibold text-lg">{fmt(display)}</div>;
}

// -------------------- Local State Hook --------------------
function useLocalState(key, initial) {
  const [state, setState] = useState(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(state));
  }, [key, state]);
  return [state, setState];
}

// -------------------- Toast Notifications --------------------
function ToastsProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const idRef = useRef(1);

  const push = (text, opts = {}) => {
    const id = idRef.current++;
    setToasts((t) => [...t, { id, text, ttl: opts.ttl || 3000, style: opts.style || "default" }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts.ttl || 3000);
  };

  return (
    <ToastContext.Provider value={{ push }}>
      {children}
      <div className="fixed top-4 right-4 flex flex-col gap-2 z-50">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`px-4 py-2 rounded-lg shadow-md text-sm font-medium transition-all
              ${
                t.style === "success"
                  ? "bg-green-100 text-green-800 border border-green-300"
                  : t.style === "danger"
                  ? "bg-red-100 text-red-800 border border-red-300"
                  : "bg-white text-slate-700 border border-slate-200"
              }`}
          >
            {t.text}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// -------------------- User Provider --------------------
function UserProvider({ children }) {
  const [user, setUser] = useLocalState("fintwitch_user", {
    username: null,
    balance: 1000,
    lastLogin: null,
    streak: 0,
    loginDates: [],
    readArticles: {},
    investments: [],
    transactions: [],
  });

  const [firebaseUser, setFirebaseUser] = useState(null);
  const { push } = useContext(ToastContext);

  // Firebase login + data sync
  useEffect(() => {
    signInAnonymously(auth);
    onAuthStateChanged(auth, async (u) => {
      if (u) {
        setFirebaseUser(u);
        const ref = doc(db, "users", u.uid);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          setUser((prev) => ({ ...prev, ...snap.data() }));
          push("Progress loaded", { style: "success" });
        } else {
          await setDoc(ref, user);
          push("Welcome to FinTwitch!", { style: "success" });
        }
      }
    });
  }, []);

  // Sync user data to Firestore
  useEffect(() => {
    const updateFirestore = async () => {
      if (!firebaseUser) return;
      const ref = doc(db, "users", firebaseUser.uid);
      await updateDoc(ref, user).catch(async () => setDoc(ref, user));
    };
    updateFirestore();
  }, [user, firebaseUser]);

  // Atomic transaction function
  const transact = (amount, { source = "system", label = null } = {}) => {
    setUser((u) => {
      const newBalance = round2(Math.max(0, u.balance + amount));
      const tx = {
        id: Date.now(),
        ts: new Date().toISOString(),
        amount: round2(amount),
        balanceAfter: newBalance,
        source,
        label,
      };
      return {
        ...u,
        balance: newBalance,
        transactions: [...(u.transactions || []), tx].slice(-200),
      };
    });
    push(`${amount > 0 ? "+" : ""}${fmt(amount)} (${label || source})`, {
      style: amount >= 0 ? "success" : "danger",
    });
  };

  const addBalance = (amt, opts) => transact(amt, opts);

  const login = (username) => {
    setUser((u) => {
      const today = todayStr();
      const was = u.lastLogin;
      let newStreak = u.streak;
      let newBalance = u.balance;
      const loginDates = new Set(u.loginDates || []);
      if (was === today) {
      } else if (was === yesterdayStr()) {
        newStreak = (u.streak || 0) + 1;
        newBalance = round2(newBalance + 10);
      } else {
        newStreak = 1;
        if (was) newBalance = Math.max(0, round2(newBalance - 20));
      }
      loginDates.add(today);
      return {
        ...u,
        username,
        balance: newBalance,
        lastLogin: today,
        streak: newStreak,
        loginDates: Array.from(loginDates).slice(-30),
      };
    });
    push("Logged in successfully", { style: "success" });
  };

  const markArticleRead = (id, reward = 10) => {
    setUser((u) => {
      if (u.readArticles[id]) return u;
      const newBal = round2(u.balance + reward);
      return {
        ...u,
        readArticles: { ...u.readArticles, [id]: true },
        balance: newBal,
      };
    });
    push(`Read article reward +${fmt(reward)}`, { style: "success" });
  };

  const invest = (investment) => setUser((u) => ({ ...u, investments: [...u.investments, investment] }));

  const realizeInvestment = (id, multiplier) =>
    setUser((u) => {
      const inv = u.investments.find((i) => i.id === id);
      if (!inv) return u;
      const returned = round2(inv.amount * multiplier);
      const nextBalance = round2(u.balance + returned);
      push(`Investment return ${fmt(returned)}`, { style: "success" });
      return {
        ...u,
        balance: nextBalance,
        investments: u.investments.filter((i) => i.id !== id),
      };
    });

  return (
    <UserContext.Provider value={{ user, setUser, transact, addBalance, login, markArticleRead, invest, realizeInvestment }}>
      {children}
    </UserContext.Provider>
  );
}

// -------------------- Main App --------------------
function ToastsProviderWrapper({ children }) {
  return <ToastsProvider>{children}</ToastsProvider>;
}

export default function App() {
  return (
  <ToastsProviderWrapper>
    <UserProvider>
      <Routes>
        <Route path="/" element={<Shell />}>
          <Route index element={<HomePage />} />
          <Route path="games" element={<GamesArea />} />
          <Route path="games/mcq" element={<MCQGame />} />
          <Route path="games/dreamlife" element={<DreamLifePlanner />} />
          <Route path="games/stockmarket" element={<StockMarketGame />} />
          <Route path="tools" element={<ToolsArea />} />
          <Route path="articles" element={<ArticlesArea />} />
          <Route path="habit" element={<HabitTracker />} />
          <Route path="transactions" element={<TransactionsArea />} />
        </Route>
      </Routes>
    </UserProvider>
  </ToastsProviderWrapper>
);

function HomePage() {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="relative flex flex-col items-center justify-center min-h-screen overflow-hidden text-center font-[Audiowide]"
    >
      {/* 🌌 Full-screen Animated GTA Gradient Background */}
      <motion.div
        className="fixed inset-0 bg-gradient-to-r from-[#0f0c29] via-[#302b63] to-[#24243e]"
        animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
        }}
        transition={{
          duration: 25,
          ease: "linear",
          repeat: Infinity,
        }}
        style={{
          backgroundSize: "200% 200%",
          zIndex: 0,
        }}
      ></motion.div>

      {/* 🌠 Floating Neon Glow Orbs */}
      <motion.div
        className="fixed w-[500px] h-[500px] bg-fuchsia-600/30 rounded-full blur-3xl top-20 left-10 mix-blend-screen"
        animate={{ x: [0, 60, -60, 0], y: [0, 40, -40, 0] }}
        transition={{ duration: 15, repeat: Infinity, ease: "easeInOut" }}
      ></motion.div>
      <motion.div
        className="fixed w-[600px] h-[600px] bg-cyan-400/25 rounded-full blur-3xl bottom-10 right-10 mix-blend-screen"
        animate={{ x: [0, -40, 40, 0], y: [0, -60, 60, 0] }}
        transition={{ duration: 20, repeat: Infinity, ease: "easeInOut" }}
      ></motion.div>

      {/* 🏙️ Main Title */}
      <motion.h1
        initial={{ opacity: 0, scale: 0.8, y: 40 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 1 }}
        className="relative z-10 text-7xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-yellow-300 via-pink-400 to-fuchsia-500 drop-shadow-[0_0_30px_rgba(255,255,255,0.3)] tracking-wide"
      >
        FinTwitch 🕹️
      </motion.h1>

      {/* 💬 Subtitle */}
      <motion.p
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.6, duration: 1 }}
        className="relative z-10 text-lg text-white/80 mt-6 max-w-xl leading-relaxed tracking-wide"
      >
        Step into the streets of{" "}
        <span className="text-fuchsia-400 font-semibold">Finance City</span>.
        <br />
        Earn, hustle, invest — your financial story begins here 💸
      </motion.p>

      {/* 🎮 Enter Game Button */}
      <motion.div
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 1, duration: 0.6 }}
        className="mt-12 relative z-20"
      >
        <Link
          to="/games"
          className="relative inline-block px-10 py-4 text-lg font-semibold rounded-full bg-gradient-to-r from-yellow-400 via-orange-400 to-red-500 text-slate-900 shadow-[0_0_20px_rgba(255,255,255,0.3)] hover:scale-110 hover:shadow-[0_0_30px_rgba(255,0,150,0.6)] transition-all duration-300"
        >
          Enter the Game →
          {/* 🌟 Animated Border Glow */}
          <motion.span
            className="absolute inset-0 rounded-full border-2 border-fuchsia-500/40"
            animate={{
              opacity: [0.4, 0.8, 0.4],
              boxShadow: [
                "0 0 10px rgba(255,0,150,0.6)",
                "0 0 30px rgba(255,0,150,0.9)",
                "0 0 10px rgba(255,0,150,0.6)",
              ],
            }}
            transition={{ duration: 3, repeat: Infinity }}
          ></motion.span>
        </Link>
      </motion.div>

      {/* ✨ Tagline */}
      <motion.div
        className="absolute bottom-10 text-white/60 text-sm tracking-widest font-light"
        animate={{ opacity: [0.6, 1, 0.6] }}
        transition={{ duration: 4, repeat: Infinity }}
      >
        “Where money meets mastery”
      </motion.div>
    </motion.div>
  );
}
/* -------------------- Game Pages -------------------- */
function MCQGamePage() {
  return (
    <GamePageLayout title="MCQ Quiz">
      <MCQGame />
    </GamePageLayout>
  );
}

// --- DreamLifePlanner (Story Mode) ---

function DreamLifePlanner() {
  const { user, transact } = useContext(UserContext);
  const { push } = useContext(ToastContext);

  const [scene, setScene] = useState(() => {
    const saved = localStorage.getItem("dreamlife_progress");
    return saved ? JSON.parse(saved).scene : 1;
  });

  const [stats, setStats] = useState(() => {
    const saved = localStorage.getItem("dreamlife_progress");
    return saved
      ? JSON.parse(saved).stats
      : { happiness: 5, consistency: 5, wisdom: 5 };
  });

  const [log, setLog] = useState([]);

  const nextScene = (next = null) => setScene((s) => next || s + 1);

  // Auto-save progress
  useEffect(() => {
    localStorage.setItem(
      "dreamlife_progress",
      JSON.stringify({ scene, stats, log })
    );
  }, [scene, stats, log]);

  const handleChoice = (choice) => {
    if (choice.cost && user.balance < choice.cost) {
      push("Not enough balance!", { style: "danger" });
      return;
    }

    if (choice.cost) transact(-choice.cost, { label: choice.label });
    if (choice.income) transact(choice.income, { label: choice.label });

    setStats((prev) => ({
      happiness: Math.max(0, prev.happiness + (choice.happiness || 0)),
      consistency: Math.max(0, prev.consistency + (choice.consistency || 0)),
      wisdom: Math.max(0, prev.wisdom + (choice.wisdom || 0)),
    }));

    setLog((l) => [...l, choice.label]);
    push(choice.feedback || "Decision made!");

    setTimeout(() => nextScene(choice.next), 1000);
  };

  // 🎭 Game scenes
  const scenes = {
    1: {
      title: "Scene 1: The Morning Dilemma 🌅",
      story:
        "It’s 8 AM. Your stomach growls as you rush to your first class. You check your wallet—money is tight.",
      choices: [
        {
          label: "Buy a good breakfast (₹50)",
          cost: 50,
          happiness: +2,
          feedback: "Yum! You feel energized.",
        },
        {
          label: "Skip breakfast, save money",
          cost: 0,
          happiness: -2,
          feedback: "You feel hungry, but at least you saved money.",
        },
        {
          label: "Grab tea with friends (₹20)",
          cost: 20,
          happiness: +1,
          consistency: +1,
          feedback: "Tea + friends = happiness ☕",
        },
      ],
    },
    2: {
      title: "Scene 2: The College Event 🎤",
      story:
        "There’s a big tech fest on campus. Everyone’s talking about it. You can buy tickets or volunteer.",
      choices: [
        {
          label: "Buy tickets (₹200)",
          cost: 200,
          happiness: +2,
          consistency: +1,
          feedback: "You enjoyed the fest! Great experience.",
        },
        {
          label: "Volunteer for free",
          cost: 0,
          consistency: +2,
          wisdom: +1,
          feedback: "You learned new skills volunteering!",
        },
        {
          label: "Skip the event",
          cost: 0,
          happiness: -1,
          feedback: "You missed some great networking chances.",
        },
      ],
    },
    3: {
      title: "Scene 3: The Freelance Offer 💼",
      story:
        "A senior offers you a quick freelance project worth ₹500. It’ll take your whole evening, though.",
      choices: [
        {
          label: "Accept the project",
          income: 500,
          consistency: -1,
          wisdom: +2,
          feedback: "You earned ₹500! Great hustle!",
          next: 4,
        },
        {
          label: "Reject it and study",
          cost: 0,
          wisdom: +3,
          feedback: "You improved your skills for exams.",
          next: 4,
        },
        {
          label: "Ignore the message",
          cost: 0,
          feedback: "You did nothing today…",
          next: 4,
        },
      ],
    },
    4: {
      title: "Scene 4: The Outcome 🧾",
      story:
        "Your first week at college ends. You reflect on your habits, finances, and how you spent your time.",
      summary: true,
    },
  };

  const sceneData = scenes[scene];
  if (!sceneData) return <div>Loading...</div>;

  return (
    <div className="p-6 max-w-3xl mx-auto text-white">
      <Link
        to="/games"
        className="inline-block mb-4 text-sm text-cyan-300 hover:text-pink-400 transition"
      >
        ← Back to Games
      </Link>

      <AnimatePresence mode="wait">
        <motion.div
          key={scene}
          initial={{ opacity: 0, y: 15 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.5 }}
          className="card-glass p-6 border border-cyan-400/20 shadow-lg rounded-2xl"
        >
          <h2 className="text-2xl font-bold mb-3 text-pink-300 drop-shadow-md">
            {sceneData.title}
          </h2>
          <p className="text-white/90 mb-6">{sceneData.story}</p>

          {/* 🌈 Scene Content */}
          {sceneData.summary ? (
            <div className="text-white/90">
              <h3 className="text-lg font-semibold mb-2 text-cyan-300">
                Your Chapter 1 Summary
              </h3>
              <ul className="space-y-1 text-sm mb-4">
                <li>💰 Balance: ₹{user.balance}</li>
                <li>😊 Happiness: {stats.happiness}</li>
                <li>📆 Consistency: {stats.consistency}</li>
                <li>🧠 Wisdom: {stats.wisdom}</li>
              </ul>
              <p className="italic text-pink-200 mb-4">
                “Every small decision shapes your financial future.”
              </p>
              <button
                onClick={() => push("More chapters coming soon!")}
                className="btn-neon text-sm"
              >
                Continue
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {sceneData.choices.map((choice, idx) => (
                <button
                  key={idx}
                  onClick={() => handleChoice(choice)}
                  className="w-full text-left px-4 py-2 bg-white/5 hover:bg-pink-400/20 rounded-lg border border-white/20 transition"
                >
                  {choice.label}
                </button>
              ))}
            </div>
          )}
        </motion.div>
      </AnimatePresence>

      {/* 🌟 Stats Bar */}
      <div className="mt-6 flex gap-6 justify-around text-sm font-medium text-white/90 bg-white/5 backdrop-blur-md py-3 px-4 rounded-xl border border-white/10">
        <div>💰 Balance: ₹{user.balance}</div>
        <div>😊 Happiness: {stats.happiness}</div>
        <div>📆 Consistency: {stats.consistency}</div>
        <div>🧠 Wisdom: {stats.wisdom}</div>
      </div>
      <button
  onClick={() => {
    localStorage.removeItem("dreamlife_progress");
    window.location.reload();
  }}
  className="mt-4 px-4 py-2 text-sm text-pink-300 hover:text-cyan-300 transition"
>
  🔁 Restart Chapter
</button>
    </div>
  );
}

// -------------------- Shell Layout --------------------
function Shell() {
  const tabs = ["Home", "Tools", "Articles", "Habit Tracker", "Transactions"];
  const [active, setActive] = useState("Games");

  return (
    <div className="relative min-h-screen overflow-hidden font-[Audiowide] text-white">
      {/* 🌈 Full-page Animated Background */}
      <motion.div
        className="fixed inset-0 bg-gradient-to-r from-[#0f0c29] via-[#302b63] to-[#24243e]"
        animate={{
          backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"],
        }}
        transition={{
          duration: 30,
          ease: "linear",
          repeat: Infinity,
        }}
        style={{
          backgroundSize: "200% 200%",
          zIndex: 0,
        }}
      ></motion.div>

      {/* 🌌 Floating Glow Orbs */}
      <motion.div
        className="fixed w-[700px] h-[700px] bg-fuchsia-500/20 rounded-full blur-3xl top-20 left-10 mix-blend-screen"
        animate={{ x: [0, 100, -60, 0], y: [0, 60, -50, 0] }}
        transition={{ duration: 25, repeat: Infinity, ease: "easeInOut" }}
        style={{ zIndex: 0 }}
      ></motion.div>
      <motion.div
        className="fixed w-[800px] h-[800px] bg-cyan-400/20 rounded-full blur-3xl bottom-0 right-10 mix-blend-screen"
        animate={{ x: [0, -60, 60, 0], y: [0, -80, 80, 0] }}
        transition={{ duration: 28, repeat: Infinity, ease: "easeInOut" }}
        style={{ zIndex: 0 }}
      ></motion.div>

      {/* 🧭 App Layout */}
      <div className="relative z-10">
        <Header />

        {/* Layout Body */}
        <div className="pt-24 px-10 flex gap-8 h-[calc(100vh-6rem)]">
          {/* 🌠 Sidebar */}
          <aside className="w-64 bg-[#1a1733]/80 backdrop-blur-xl rounded-2xl p-4 shadow-lg border border-fuchsia-500/30 hover:border-fuchsia-400 hover:shadow-fuchsia-400/40 transition-all duration-300">
            <LeftNav tabs={tabs} active={active} onChange={setActive} />
          </aside>

          {/* 🌃 Main Content */}
          <main className="flex-1 bg-[#1a1733]/70 backdrop-blur-xl rounded-2xl p-8 shadow-lg border border-cyan-400/30 hover:border-cyan-300 hover:shadow-cyan-400/40 transition-all duration-300 overflow-y-auto">
            <Outlet />
          </main>
        </div>
      </div>
    </div>
  );
}
// -------------------- Header --------------------
function Header() {
  const { user, login } = useContext(UserContext);
  const { push } = useContext(ToastContext);
  const [name, setName] = useState("");

  return (
    <header className="fixed top-0 left-0 w-full z-50 backdrop-blur-md bg-black/70 border-b border-fuchsia-700/40 p-4 shadow-[0_0_20px_rgba(255,0,150,0.3)]">
      <div className="max-w-8xl mx-auto flex items-center justify-between px-6">
        {/* 🔥 Title */}
        <h1 className="text-3xl font-[Audiowide] text-transparent bg-clip-text bg-gradient-to-r from-fuchsia-400 via-pink-300 to-purple-300 drop-shadow-[0_0_10px_rgba(255,0,150,0.6)] tracking-wide">
          FinTwitch
        </h1>

        {/* 💰 User Section */}
        <div className="flex items-center gap-6 text-sm text-fuchsia-200">
          {user ? (
            <>
              <span className="text-cyan-300">Welcome, {user.name || "Player"}</span>
              <span className="bg-gradient-to-r from-green-400 to-emerald-500 text-black font-semibold px-3 py-1 rounded-full shadow-[0_0_15px_rgba(16,185,129,0.4)]">
                ₹{user.balance?.toFixed(2) || "0.00"}
              </span>
            </>
          ) : (
            <button
              onClick={() => {
                if (!name) {
                  push("Please enter your name before login!", { style: "danger" });
                  return;
                }
                login(name);
              }}
              className="btn-neon"
            >
              Enter City
            </button>
          )}
        </div>
      </div>
    </header>
  );
}

// -------------------- Left Nav --------------------
function LeftNav() {
  const location = useLocation();
  const links = [
    { label: "Home", to: "/games" },
    { label: "Tools", to: "/tools" },
    { label: "Articles", to: "/articles" },
    { label: "Habit Tracker", to: "/habit" },
    { label: "Transactions", to: "/transactions" },
  ];

  return (
    <nav>
      <ul className="space-y-2">
        {links.map((link) => {
          const active = location.pathname.startsWith(link.to);
          return (
            <li key={link.to}>
              <Link
                to={link.to}
                className={`block px-3 py-2 rounded ${
                  active ? "bg-indigo-600 text-white" : "text-slate-700 hover:bg-slate-100"
                }`}
              >
                {link.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

// -------------------- Games --------------------
/* -------------------- Games -------------------- */
function GamesArea() {
  const { user } = useContext(UserContext);

  const games = [
    { key: "mcq", title: "MCQ Quiz", desc: "Test your finance IQ with quick questions.", to: "/games/mcq" },
    { key: "dreamlife", title: "Dream Life Planner", desc: "Story-driven choices that affect your balance.", to: "/games/dreamlife" },
    { key: "stock", title: "Stock Market Simulator", desc: "Buy/sell simplified stocks and learn.", to: "/games/stockmarket" },
  ];

  const insights = [
    "💹 Nifty hits record high — investors celebrate small-cap surge.",
    "💸 RBI maintains repo rate — focus shifts to inflation outlook.",
    "🏦 Mutual funds see ₹10,000 cr inflows in September SIPs.",
    "🧠 Gen Z investors show 40% rise in financial literacy.",
  ];

  const wealthWisdom = [
    { quote: "“Invest in your future — every rupee counts.”", author: "FinTwitch Team" },
    { quote: "“Discipline builds wealth, not luck.”", author: "Unknown" },
    { quote: "“Stay consistent — compounding rewards the patient.”", author: "Warren Buffett" },
  ];

  // 💰 Wealth Terms of the Day (rotates daily)
  const wealthTerms = [
    { term: "Asset Allocation", meaning: "Spreading money across investments to balance risk." },
    { term: "Compound Interest", meaning: "The interest that earns interest — the power of compounding." },
    { term: "Diversification", meaning: "Don’t put all your eggs in one basket — spread your risk." },
    { term: "Inflation", meaning: "The silent killer of purchasing power — prices rise over time." },
    { term: "Liquidity", meaning: "How quickly you can convert assets to cash without losing value." },
    { term: "Emergency Fund", meaning: "Cash saved for unexpected expenses like job loss or medical bills." },
    { term: "Net Worth", meaning: "What you own minus what you owe — your real financial value." },
  ];

  const todayIndex = new Date().getDate() % wealthTerms.length;
  const todayTerm = wealthTerms[todayIndex];

  return (
    <div className="space-y-8">
      {/* 🧾 Player Dashboard */}
      <div className="card-glass p-5 flex flex-wrap items-center justify-between gap-6">
        <div>
          <h2 className="text-3xl font-bold text-fuchsia-300 drop-shadow-[0_0_15px_rgba(244,114,182,0.6)]">
            Welcome back, {user?.username || "Player"} 💸
          </h2>
          <p className="text-sm text-cyan-200 mt-2 italic">
            “Every decision makes you richer — play smart, grow smarter.”
          </p>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="px-4 py-2 rounded-lg bg-[#141026]/60 border border-fuchsia-500/30 text-center w-28">
            <div className="text-xs text-slate-400">Balance</div>
            <div className="text-lg font-bold text-green-300">{fmt(user?.balance || 0)}</div>
          </div>
          <div className="px-4 py-2 rounded-lg bg-[#141026]/60 border border-cyan-400/20 text-center w-28">
            <div className="text-xs text-slate-400">Games Played</div>
            <div className="text-lg font-bold text-yellow-300">{(user?.transactions || []).length}</div>
          </div>
          <div className="px-4 py-2 rounded-lg bg-[#141026]/60 border border-pink-400/20 text-center w-28">
            <div className="text-xs text-slate-400">Level</div>
            <div className="text-lg font-bold text-pink-300">4</div>
          </div>
        </div>
      </div>

      {/* 🎮 Games Grid */}
      <div className="grid md:grid-cols-3 gap-6">
        {games.map((g) => (
          <motion.div
            key={g.key}
            whileHover={{ scale: 1.03, y: -6 }}
            className="card-glass p-6 rounded-xl flex flex-col justify-between h-[200px]"
          >
            <div>
              <h3 className="text-xl font-semibold text-fuchsia-300 mb-1">{g.title}</h3>
              <p className="text-sm text-cyan-200/90">{g.desc}</p>
            </div>

            <div className="mt-4 flex justify-between items-center">
              <Link to={g.to} className="btn-neon text-sm px-6 py-2">
                Play Now →
              </Link>
              <span className="text-xs text-slate-400">⏱ 2–5 min</span>
            </div>
          </motion.div>
        ))}
      </div>

      {/* 🌆 Finance Insights + 💡 Wealth Wisdom */}
      <div className="grid md:grid-cols-2 gap-6">
        {/* 💡 Wealth Wisdom */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
          className="card-glass p-6 rounded-xl"
        >
          <h3 className="text-lg font-semibold text-yellow-300 mb-3">💡 Wealth Wisdom</h3>
          {wealthWisdom.map((item, i) => (
            <div key={i} className="mb-3 border-l-4 border-fuchsia-400 pl-3">
              <p className="text-cyan-100 italic mb-1">{item.quote}</p>
              <p className="text-xs text-fuchsia-300">— {item.author}</p>
            </div>
          ))}
        </motion.div>

        {/* 📰 Finance Insights */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="card-glass p-6 rounded-xl"
        >
          <h3 className="text-lg font-semibold text-pink-300 mb-3">📰 Finance Insights</h3>
          <div className="text-sm text-cyan-200/90 space-y-2">
            {insights.map((item, idx) => (
              <p key={idx} className="hover:text-fuchsia-300 cursor-pointer transition">
                {item}
              </p>
            ))}
          </div>
        </motion.div>
      </div>

      {/* 💰 Wealth Term of the Day */}
      <div className="card-glass p-6 rounded-xl mt-6 text-center">
        <h3 className="text-xl font-semibold text-cyan-300 mb-3">💰 Wealth Term of the Day</h3>
        <p className="text-fuchsia-300 text-2xl mb-2">{todayTerm.term}</p>
        <p className="text-cyan-100 italic mb-4">{todayTerm.meaning}</p>
        <button
          className="btn-neon text-sm px-6 py-2"
          onClick={() => alert(`Detailed content for "${todayTerm.term}" coming soon!`)}
        >
          Learn More →
        </button>
      </div>
    </div>
  );
}
// --- MCQ Game ---
function MCQGame() {
  const qs = [
    { q: "What is diversification?", opts: ["One asset", "Mix assets", "Cash only"], a: 1 },
    { q: "Which is riskier?", opts: ["Bonds", "Stocks", "Bank FD"], a: 1 },
    { q: "Best for long term?", opts: ["Compounding", "Trading", "Saving"], a: 0 },
  ];
  const { transact } = useContext(UserContext);
  const [i, setI] = useState(0);
  const [sel, setSel] = useState(null);
  const [locked, setLocked] = useState(false);
  const { push } = useContext(ToastContext);

  const submit = () => {
    if (sel === null) return push("Choose one!", { ttl: 1500 });
    setLocked(true);
    if (sel === qs[i].a) {
      transact(50, { source: "mcq", label: "MCQ Correct" });
      push("Correct! +₹50");
    } else {
      transact(-10, { source: "mcq", label: "MCQ Wrong" });
      push("Wrong! -₹10", { style: "danger" });
    }
    setTimeout(() => {
      setSel(null);
      setLocked(false);
      setI((p) => (p + 1) % qs.length);
    }, 900);
  };

  return (
    <div>
      <Link
        to="/games"
        className="inline-block mb-3 text-sm text-indigo-600 hover:underline"
      >
        ← Back to Games
      </Link>

      <div className="text-sm mb-3">{qs[i].q}</div>
      {qs[i].opts.map((o, idx) => (
        <button
          key={idx}
          onClick={() => setSel(idx)}
          className={`block w-full text-left p-2 mb-2 border rounded ${
            sel === idx ? "bg-indigo-50" : ""
          }`}
          disabled={locked}
        >
          {o}
        </button>
      ))}
      <button
        onClick={submit}
        className="mt-2 px-3 py-1 bg-green-600 text-white rounded"
        disabled={locked}
      >
        Submit
      </button>
    </div>
  );
}

// --- Stock Market Game  ---
function StockMarketGame() {
  const { user, transact } = useContext(UserContext);
  const [stocks, setStocks] = useState([
    { symbol: "RELIANCE", price: 2500 },
    { symbol: "TCS", price: 3500 },
    { symbol: "INFY", price: 1500 },
    { symbol: "HDFC", price: 2800 },
    { symbol: "ICICI", price: 950 },
    { symbol: "KOTAK", price: 1900 },
    { symbol: "SBIN", price: 620 },
    { symbol: "AXISBANK", price: 980 },
    { symbol: "HDFCBANK", price: 1650 },
    { symbol: "BAJAJFINSV", price: 1700 },
    { symbol: "BAJFINANCE", price: 7200 },
    { symbol: "ADANIGREEN", price: 920 },
    { symbol: "ADANIPORTS", price: 850 },
    { symbol: "ITC", price: 480 },
    { symbol: "HUL", price: 2600 },
    { symbol: "MARUTI", price: 9200 },
    { symbol: "TATAMOTORS", price: 950 },
    { symbol: "M&M", price: 1700 },
    { symbol: "EICHERMOT", price: 3650 },
    { symbol: "HEROMOTOCO", price: 2950 },
    { symbol: "SUNPHARMA", price: 1100 },
    { symbol: "DRREDDY", price: 6200 },
    { symbol: "CIPLA", price: 1240 },
    { symbol: "DIVISLAB", price: 3600 },
    { symbol: "BIOCON", price: 260 },
    { symbol: "LT", price: 3400 },
    { symbol: "ULTRACEMCO", price: 8900 },
    { symbol: "GRASIM", price: 2100 },
    { symbol: "SHREECEM", price: 25500 },
    { symbol: "JSWSTEEL", price: 800 },
    { symbol: "TATASTEEL", price: 130 },
    { symbol: "HINDALCO", price: 500 },
    { symbol: "VEDL", price: 280 },
    { symbol: "ONGC", price: 190 },
    { symbol: "BPCL", price: 360 },
    { symbol: "IOC", price: 150 },
    { symbol: "NTPC", price: 320 },
    { symbol: "POWERGRID", price: 250 },
    { symbol: "COALINDIA", price: 310 },
    { symbol: "BEL", price: 190 },
    { symbol: "IRCTC", price: 850 },
    { symbol: "ZOMATO", price: 115 },
    { symbol: "NYKAA", price: 160 },
    { symbol: "PAYTM", price: 420 },
    { symbol: "DELHIVERY", price: 480 },
    { symbol: "POLYCAB", price: 5900 },
    { symbol: "ABB", price: 5600 },
    { symbol: "SIEMENS", price: 5300 },
    { symbol: "PIDILITIND", price: 2650 },
  ]);
  const [portfolio, setPortfolio] = useState([]);

  // Simulate price updates every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      setStocks((prev) =>
        prev.map((s) => {
          const change = (Math.random() * 0.04 - 0.02) * s.price; // ±2%
          return { ...s, price: Math.max(50, (s.price + change).toFixed(2)) };
        })
      );
    }, 10000); // 10 seconds
    return () => clearInterval(interval);
  }, []);

  const buyStock = (stock) => {
    if (user.balance < stock.price) return alert("Not enough balance!");
    transact(-stock.price, { source: "stock", label: `Bought ${stock.symbol}` });
    setPortfolio((p) => [...p, { ...stock, buyPrice: stock.price }]);
  };

  const sellStock = (index) => {
    const stock = portfolio[index];
    transact(stock.price, { source: "stock", label: `Sold ${stock.symbol}` });
    setPortfolio((p) => p.filter((_, i) => i !== index));
  };

  return (
    <div>
      <Link to="/games" className="inline-block mb-3 text-sm text-indigo-600 hover:underline">
        ← Back to Games
      </Link>

      <h2 className="text-xl font-bold mb-4">Stock Market Simulator</h2>

      <div className="grid md:grid-cols-2 gap-4">
        {/* Stock List */}
        <div className="p-3 border rounded h-[500px] overflow-y-scroll">
          <h3 className="font-semibold mb-2">Available Stocks</h3>
          {stocks.map((s) => (
            <div key={s.symbol} className="flex justify-between items-center mb-2">
              <span>{s.symbol}: ₹{s.price}</span>
              <button
                onClick={() => buyStock(s)}
                className="px-2 py-1 bg-green-600 text-white rounded text-sm"
              >
                Buy
              </button>
            </div>
          ))}
        </div>

        {/* Portfolio */}
        <div className="p-3 border rounded h-[500px] overflow-y-scroll">
          <h3 className="font-semibold mb-2">Your Portfolio</h3>
          {portfolio.length === 0 && <p className="text-sm text-slate-500">No holdings yet.</p>}
          {portfolio.map((s, idx) => (
            <div key={idx} className="flex justify-between items-center mb-2">
              <span>
                {s.symbol}: Bought at ₹{s.buyPrice}, Now ₹{stocks.find(st => st.symbol === s.symbol)?.price}
              </span>
              <button
                onClick={() => sellStock(idx)}
                className="px-2 py-1 bg-red-600 text-white rounded text-sm"
              >
                Sell
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
// -------------------- Tools --------------------
function ToolsArea() {
  const [fireCorpus, setFireCorpus] = useState("");
  const [tax, setTax] = useState("");
  const [fireResult, setFireResult] = useState("");
  const [taxResult, setTaxResult] = useState("");
  const [sipResult, setSipResult] = useState("");
  const [emiResult, setEmiResult] = useState("");
  const [inflationResult, setInflationResult] = useState("");
  const [returnResult, setReturnResult] = useState("");

  // --- FIRE Calculator ---
  const calcFire = () => {
    const val = 25 * parseFloat(fireCorpus || 0);
    setFireResult(val ? `Required corpus: ₹${val.toLocaleString()}` : "Enter your annual expenses 💸");
  };

  // --- Tax Calculator ---
  const calcTax = () => {
    const taxable = parseFloat(tax || 0);
    const result = taxable * 0.05;
    setTaxResult(`Tax Payable: ₹${result.toLocaleString()}`);
  };

  // --- SIP Calculator ---
  const calcSIP = (investment, rate, years) => {
    const monthlyRate = rate / 12 / 100;
    const months = years * 12;
    const futureValue =
      investment * ((Math.pow(1 + monthlyRate, months) - 1) / monthlyRate) * (1 + monthlyRate);
    setSipResult(`Future Value: ₹${futureValue.toFixed(2)}`);
  };

  // --- EMI Calculator ---
  const calcEMI = (loan, rate, years) => {
    const monthlyRate = rate / 12 / 100;
    const months = years * 12;
    const emi =
      (loan * monthlyRate * Math.pow(1 + monthlyRate, months)) /
      (Math.pow(1 + monthlyRate, months) - 1);
    const total = emi * months;
    const interest = total - loan;
    setEmiResult(`EMI: ₹${emi.toFixed(2)} | Interest: ₹${interest.toFixed(2)}`);
  };

  // --- Inflation Calculator ---
  const calcInflation = (amount, rate, years) => {
    const reduced = amount / Math.pow(1 + rate / 100, years);
    setInflationResult(`After ${years} years, ₹${amount} will be worth ₹${reduced.toFixed(2)}`);
  };

  // --- Return Measurer (CAGR) ---
  const calcReturn = (start, end, years) => {
    if (!start || !end || !years) return setReturnResult("Please fill all fields 📊");
    const cagr = ((end / start) ** (1 / years) - 1) * 100;
    setReturnResult(`CAGR: ${cagr.toFixed(2)}%`);
  };

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6 text-white">
      {/* FIRE Calculator */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">FIRE Calculator</h3>
        <input
          type="number"
          placeholder="Your annual expenses (₹)"
          className="w-full p-2 rounded bg-[#1a1733]/80 mb-3"
          onChange={(e) => setFireCorpus(e.target.value)}
        />
        <button onClick={calcFire} className="btn-neon w-fit self-start mb-2">Calculate</button>
        <p className="text-cyan-300 text-sm">{fireResult}</p>
      </div>

      {/* Tax Calculator */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">Tax Calculator</h3>
        <input
          type="number"
          placeholder="Your taxable income (₹)"
          className="w-full p-2 rounded bg-[#1a1733]/80 mb-3"
          onChange={(e) => setTax(e.target.value)}
        />
        <button onClick={calcTax} className="btn-neon w-fit self-start mb-2">Calculate</button>
        <p className="text-cyan-300 text-sm">{taxResult}</p>
      </div>

      {/* Return Measurer */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">Return Measurer (CAGR)</h3>
        <input type="number" placeholder="Start value (₹)" id="ret1" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="End value (₹)" id="ret2" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Years" id="ret3" className="w-full p-2 rounded bg-[#1a1733]/80 mb-3" />
        <button
          onClick={() =>
            calcReturn(
              parseFloat(document.getElementById("ret1").value),
              parseFloat(document.getElementById("ret2").value),
              parseFloat(document.getElementById("ret3").value)
            )
          }
          className="btn-neon w-fit self-start mb-2"
        >
          Calculate
        </button>
        <p className="text-cyan-300 text-sm">{returnResult}</p>
      </div>

      {/* SIP Calculator */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">SIP Calculator</h3>
        <input type="number" placeholder="Monthly investment (₹)" id="sip1" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Annual return (%)" id="sip2" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Years" id="sip3" className="w-full p-2 rounded bg-[#1a1733]/80 mb-3" />
        <button
          onClick={() =>
            calcSIP(
              parseFloat(document.getElementById("sip1").value),
              parseFloat(document.getElementById("sip2").value),
              parseFloat(document.getElementById("sip3").value)
            )
          }
          className="btn-neon w-fit self-start mb-2"
        >
          Calculate
        </button>
        <p className="text-cyan-300 text-sm">{sipResult}</p>
      </div>

      {/* EMI Calculator */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">Loan EMI Calculator</h3>
        <input type="number" placeholder="Loan amount (₹)" id="emi1" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Interest rate (%)" id="emi2" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Years" id="emi3" className="w-full p-2 rounded bg-[#1a1733]/80 mb-3" />
        <button
          onClick={() =>
            calcEMI(
              parseFloat(document.getElementById("emi1").value),
              parseFloat(document.getElementById("emi2").value),
              parseFloat(document.getElementById("emi3").value)
            )
          }
          className="btn-neon w-fit self-start mb-2"
        >
          Calculate
        </button>
        <p className="text-cyan-300 text-sm">{emiResult}</p>
      </div>

      {/* Inflation Calculator */}
      <div className="card-glass p-6 flex flex-col justify-between h-[280px]">
        <h3 className="text-lg font-semibold mb-2 text-pink-300">Inflation Impact</h3>
        <input type="number" placeholder="Amount (₹)" id="inf1" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Inflation rate (%)" id="inf2" className="w-full p-2 rounded bg-[#1a1733]/80 mb-2" />
        <input type="number" placeholder="Years" id="inf3" className="w-full p-2 rounded bg-[#1a1733]/80 mb-3" />
        <button
          onClick={() =>
            calcInflation(
              parseFloat(document.getElementById("inf1").value),
              parseFloat(document.getElementById("inf2").value),
              parseFloat(document.getElementById("inf3").value)
            )
          }
          className="btn-neon w-fit self-start mb-2"
        >
          Calculate
        </button>
        <p className="text-cyan-300 text-sm">{inflationResult}</p>
      </div>
    </div>
  );
}
/* -------------------- Articles -------------------- */
// -------------------- Articles --------------------
function ArticleQuiz({ quiz, onComplete }) {
  const [index, setIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selected, setSelected] = useState(null);
  const [finished, setFinished] = useState(false);

  const handleSubmit = () => {
    if (selected === null) return;
    if (selected === quiz[index].a) setScore((s) => s + 1);

    if (index + 1 < quiz.length) {
      setSelected(null);
      setIndex(index + 1);
    } else {
      const finalScore = score + (selected === quiz[index].a ? 1 : 0);
      setFinished(true);
      onComplete(finalScore);
    }
  };

  if (finished) return null;
  const q = quiz[index];

  return (
    <div className="mt-4 border-t border-fuchsia-400/30 pt-3">
      <p className="font-semibold mb-3 text-cyan-300">{q.q}</p>
      {q.opts.map((opt, i) => (
        <button
          key={i}
          onClick={() => setSelected(i)}
          className={`block w-full text-left px-3 py-2 mb-2 rounded-lg border border-fuchsia-400/30 transition-all duration-200 ${
            selected === i ? "bg-fuchsia-500/30 shadow-[0_0_10px_rgba(244,114,182,0.4)]" : "bg-[#1a1733]/70"
          }`}
        >
          {opt}
        </button>
      ))}
      <button
        onClick={handleSubmit}
        className="btn-neon mt-3"
      >
        Submit
      </button>
    </div>
  );
}

function ArticlesArea() {
  const articles = [
    {
      id: "a1",
      title: "The Power of Compounding 💫",
      excerpt: "Learn how small investments grow big over time.",
      content: `
Compounding is like a magic snowball. When you invest and let your returns earn more returns, your money grows exponentially. 
For example, ₹10,000 invested at 10% annually becomes ₹26,000 in 10 years and ₹67,000 in 20 years—without adding a single rupee more. 
The earlier you start, the more time your money has to compound. Even Einstein called it “the eighth wonder of the world.” 
Consistency and patience are the keys to unlocking compounding power.`,
      quiz: [
        { q: "What does compounding mean?", opts: ["Interest on interest", "Spending money", "No growth"], a: 0 },
        { q: "What grows faster: simple or compound?", opts: ["Simple", "Compound"], a: 1 },
        { q: "What is key to compounding?", opts: ["Patience", "Luck"], a: 0 },
      ],
      reward: 50,
    },
    {
      id: "a2",
      title: "Smart Budgeting 💰",
      excerpt: "Control your expenses to control your life.",
      content: `
Budgeting isn't about restriction—it’s about direction. 
By tracking your income and expenses, you take charge of your money instead of wondering where it went. 
The 50-30-20 rule is a good start: 50% needs, 30% wants, 20% savings.`,
      quiz: [
        { q: "What is the 50-30-20 rule?", opts: ["Budgeting rule", "Tax rule"], a: 0 },
        { q: "What is budgeting about?", opts: ["Restriction", "Direction"], a: 1 },
        { q: "What % goes to savings?", opts: ["10%", "20%"], a: 1 },
      ],
      reward: 40,
    },
    {
      id: "a3",
      title: "Why You Need an Emergency Fund 🚨",
      excerpt: "Save before you spend, because life is unpredictable.",
      content: `
Emergencies can strike anytime—medical bills, job loss, or urgent repairs. 
An emergency fund acts as your financial shield.`,
      quiz: [
        { q: "How many months’ expenses should you save?", opts: ["1-2", "3-6"], a: 1 },
        { q: "Emergency fund should be:", opts: ["Locked in FD", "Easily accessible"], a: 1 },
        { q: "Why have it?", opts: ["For emergencies", "To shop more"], a: 0 },
      ],
      reward: 60,
    },
  ];

  const { user, markArticleRead } = useContext(UserContext);
  const { push } = useContext(ToastContext);
  const [open, setOpen] = useState(null);
  const [showQuiz, setShowQuiz] = useState(false);
  const [readHistory, setReadHistory] = useState(() => {
    const saved = localStorage.getItem("fintwitch_read_history");
    return saved ? JSON.parse(saved) : [];
  });

  const contentRef = useRef(null);

  const handleScroll = (e) => {
    const { scrollTop, scrollHeight, clientHeight } = e.target;
    if (scrollTop + clientHeight >= scrollHeight - 10) setShowQuiz(true);
  };

  const handleQuizComplete = (score, article) => {
    if (score >= 2) {
      markArticleRead(article.id, article.reward);
      const newRecord = {
        id: article.id,
        title: article.title,
        date: new Date().toLocaleString(),
        reward: article.reward,
      };
      const updated = [...readHistory, newRecord];
      setReadHistory(updated);
      localStorage.setItem("fintwitch_read_history", JSON.stringify(updated));
      push(`🎉 You scored ${score}/3 and earned ₹${article.reward}!`, { style: "success" });
    } else {
      push(`You scored ${score}/3. Try again next time!`, { style: "danger" });
    }
    setShowQuiz(false);
  };

  return (
    <div className="text-white space-y-8">
      <h2 className="text-3xl font-bold text-fuchsia-300 drop-shadow-[0_0_10px_rgba(244,114,182,0.6)]">
        📚 Articles & Rewards
      </h2>

      {articles.map((a) => (
        <div
          key={a.id}
          className={`card-glass p-4 rounded-xl border border-fuchsia-400/30 transition-all duration-300 hover:scale-[1.01] ${
            open === a.id ? "shadow-[0_0_25px_rgba(244,114,182,0.4)]" : ""
          }`}
        >
          <div className="flex justify-between items-start">
            <div>
              <p className="font-semibold text-cyan-300 text-lg">{a.title}</p>
              <p className="text-sm text-slate-300 italic">{a.excerpt}</p>
            </div>
            <button
              onClick={() => {
                setOpen(a.id === open ? null : a.id);
                setShowQuiz(false);
              }}
              className="btn-neon px-3 py-1 text-sm"
            >
              {open === a.id ? "Close" : "Read"}
            </button>
          </div>

          {open === a.id && (
            <div
              ref={contentRef}
              onScroll={handleScroll}
              className="mt-3 p-3 bg-[#1a1733]/70 rounded-lg border border-fuchsia-400/20 text-slate-100 h-48 overflow-y-auto"
            >
              {a.content.split("\n").map((line, i) => (
                <p key={i} className="mb-2">{line.trim()}</p>
              ))}

              {!showQuiz && (
                <p className="italic text-xs text-slate-400 mt-3">
                  Scroll to the bottom to unlock quiz 🔓
                </p>
              )}

              {showQuiz && (
                <ArticleQuiz
                  quiz={a.quiz}
                  onComplete={(score) => handleQuizComplete(score, a)}
                />
              )}
            </div>
          )}
        </div>
      ))}

      {/* Reading History */}
      <div className="card-glass p-4 rounded-xl mt-6">
        <h3 className="text-xl font-semibold text-fuchsia-300 mb-3">📖 Reading History</h3>
        {readHistory.length === 0 ? (
          <p className="text-sm text-slate-400">No articles read yet. Start exploring!</p>
        ) : (
          <div className="space-y-2">
            {readHistory
              .slice()
              .reverse()
              .map((h, idx) => (
                <div
                  key={idx}
                  className="flex justify-between items-center bg-[#1a1733]/60 border border-fuchsia-400/20 rounded-lg p-2 text-sm text-slate-200"
                >
                  <div>
                    <p className="font-medium text-cyan-200">{h.title}</p>
                    <p className="text-xs text-slate-400">{h.date}</p>
                  </div>
                  <span className="text-green-400 font-semibold">+₹{h.reward}</span>
                </div>
              ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* -------------------- Habit Tracker -------------------- */
function HabitTracker() {
  const today = new Date().toISOString().split("T")[0];
  const [tasks, setTasks] = useState([
    { id: 1, text: "Read 1 Article", done: false },
    { id: 2, text: "Play a Game", done: false },
    { id: 3, text: "Log In Today", done: false },
  ]);

  const [streak, setStreak] = useState(() => {
    const saved = JSON.parse(localStorage.getItem("fintwitch_streak")) || {
      current: 0,
      best: 0,
      lastDate: null,
      history: [],
    };
    return saved;
  });

  // ✅ Toggle task completion
  const toggleTask = (id) => {
    const updated = tasks.map((t) =>
      t.id === id ? { ...t, done: !t.done } : t
    );
    setTasks(updated);
  };

  // 🔁 Calculate yesterday for streak logic
  const getYesterday = () => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return d.toISOString().split("T")[0];
  };

  // 💾 Auto-update streak when all tasks done
  useEffect(() => {
    const allDone = tasks.every((t) => t.done);
    if (allDone && streak.lastDate !== today) {
      const newCurrent =
        streak.lastDate === getYesterday() ? streak.current + 1 : 1;
      const newBest = Math.max(newCurrent, streak.best);
      const updated = {
        current: newCurrent,
        best: newBest,
        lastDate: today,
        history: [...streak.history, today],
      };
      setStreak(updated);
      localStorage.setItem("fintwitch_streak", JSON.stringify(updated));
    }
  }, [tasks]);

  // 🧹 Reset streak + tasks
  const handleReset = () => {
    if (confirm("Are you sure you want to reset your progress?")) {
      localStorage.removeItem("fintwitch_streak");
      setStreak({ current: 0, best: 0, lastDate: null, history: [] });
      setTasks((t) => t.map((task) => ({ ...task, done: false })));
    }
  };

  // 📆 Generate last 30 days streak visualization
  const last30 = [...Array(30)].map((_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (29 - i));
    const dateStr = d.toISOString().split("T")[0];
    const active = streak.history.includes(dateStr);
    return { dateStr, active };
  });

  return (
    <div className="space-y-6 text-white">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold mb-1">🔥 Habit Tracker</h2>
          <p className="text-sm text-fuchsia-300 italic">
            Build consistency — your wealth journey depends on habits 💪
          </p>
        </div>
        <button
          onClick={handleReset}
          className="btn-neon text-sm px-4 py-1 rounded-full shadow-md"
        >
          Reset 🔄
        </button>
      </div>

      {/* 🧩 Daily Tasks */}
      <div className="card-glass p-4 grid gap-3">
        <h3 className="text-lg font-semibold mb-2 text-cyan-300">Today's Tasks</h3>
        {tasks.map((t) => (
          <button
            key={t.id}
            onClick={() => toggleTask(t.id)}
            className={`px-4 py-2 rounded-lg border transition-all ${
              t.done
                ? "bg-gradient-to-r from-green-400 to-emerald-500 text-black font-semibold"
                : "bg-[#1a1733] hover:bg-[#242043]"
            }`}
          >
            {t.done ? "✅ " : "⬜ "} {t.text}
          </button>
        ))}
      </div>

      {/* 📆 Streak Calendar */}
      <div className="card-glass p-4">
        <h3 className="text-lg font-semibold mb-3 text-yellow-300">
          Your 30-Day Streak
        </h3>
        <div className="grid grid-cols-10 gap-2">
          {last30.map((d, i) => (
            <div
              key={i}
              title={d.dateStr}
              className={`w-6 h-6 rounded-md transition-all ${
                d.active
                  ? "bg-gradient-to-br from-pink-400 to-cyan-400 shadow-lg"
                  : "bg-[#2a254d] hover:bg-[#3a3268]"
              }`}
            ></div>
          ))}
        </div>
      </div>

      {/* 📊 Streak Stats */}
      <div className="card-glass p-4 flex justify-between text-sm">
        <p>
          🔥 Current Streak:{" "}
          <span className="text-yellow-300 font-bold">{streak.current}</span>
        </p>
        <p>
          🏆 Best Streak:{" "}
          <span className="text-fuchsia-400 font-bold">{streak.best}</span>
        </p>
        <p>
          📅 Last Completed:{" "}
          <span className="text-cyan-300">{streak.lastDate || "None"}</span>
        </p>
      </div>

      {/* 💬 Motivation */}
      <motion.p
        className="text-center text-fuchsia-200 italic mt-4"
        animate={{ opacity: [0.8, 1, 0.8] }}
        transition={{ duration: 2, repeat: Infinity }}
      >
        “Keep showing up — your habits build your empire 👑”
      </motion.p>
    </div>
  );
}
/* -------------------- Transactions -------------------- */
function TransactionsArea() {
  const { user } = useContext(UserContext);

  return (
    <div className="space-y-4 text-white">
      <h3 className="text-2xl font-bold mb-4 text-fuchsia-300 drop-shadow-[0_0_10px_rgba(244,114,182,0.6)]">
        💳 Transactions
      </h3>

      {(!user.transactions || user.transactions.length === 0) && (
        <div className="text-sm text-fuchsia-200 italic">
          No transactions yet. Start playing to earn or spend!
        </div>
      )}

      <div className="space-y-3 max-h-[70vh] overflow-y-auto pr-2">
        {user.transactions
          .slice()
          .reverse()
          .map((tx) => (
            <div
              key={tx.id}
              className="card-glass flex justify-between items-center p-3 rounded-xl transition-all hover:scale-[1.02] hover:shadow-[0_0_15px_rgba(34,211,238,0.4)]"
            >
              <div>
                <div className="text-sm font-semibold text-cyan-200">
                  {tx.label || tx.source}
                </div>
                <div className="text-xs text-fuchsia-300">
                  {new Date(tx.ts).toLocaleString()}
                </div>
              </div>

              <div
                className={`text-lg font-bold ${
                  tx.amount >= 0
                    ? "text-green-400 drop-shadow-[0_0_10px_rgba(74,222,128,0.5)]"
                    : "text-pink-400 drop-shadow-[0_0_10px_rgba(244,114,182,0.5)]"
                }`}
              >
                {tx.amount >= 0 ? "+" : ""}
                ₹{Math.abs(tx.amount).toFixed(2)}
              </div>
            </div>
          ))}
      </div>
    </div>
  );
}
}