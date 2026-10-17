import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import { useLedger } from "./lib/useLedger";
import { usePlaidConnect } from "./lib/usePlaidConnect";
import Auth from "./screens/Auth";
import Overview from "./screens/Overview";
import Activity from "./screens/Activity";
import Spending from "./screens/Spending";
import Accounts from "./screens/Accounts";
import Notice from "./components/Notice";
import { AccountsIcon, ActivityIcon, OverviewIcon, SpendingIcon } from "./components/Icons";

const TABS = [
  { id: "overview", label: "Overview", Icon: OverviewIcon },
  { id: "activity", label: "Activity", Icon: ActivityIcon },
  { id: "spending", label: "Spending", Icon: SpendingIcon },
  { id: "accounts", label: "Accounts", Icon: AccountsIcon },
];

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div className="boot" aria-busy="true" />;
  if (!session) return <Auth />;
  return <Ledger session={session} />;
}

function Ledger({ session }) {
  const [tab, setTab] = useState("overview");
  const [activityFilter, setActivityFilter] = useState(null);
  const ledger = useLedger(session);
  const plaid = usePlaidConnect({ onLinked: ledger.reload });

  const go = (id, filter = null) => { setActivityFilter(filter); setTab(id); window.scrollTo(0, 0); };
  const props = { ledger, plaid, go };

  return (
    <div className="app">
      <main className="screen">
        {(plaid.message || plaid.error) && (
          <Notice tone={plaid.error ? "error" : "info"} onDismiss={plaid.clearMessage}>{plaid.error || plaid.message}</Notice>
        )}
        {ledger.error && <Notice tone="error">Couldn’t load your data: {ledger.error}</Notice>}
        {ledger.loading ? (
          <div className="loading" aria-busy="true">Loading your accounts…</div>
        ) : (
          <>
            {tab === "overview" && <Overview {...props} />}
            {tab === "activity" && <Activity {...props} initialFilter={activityFilter} />}
            {tab === "spending" && <Spending {...props} />}
            {tab === "accounts" && <Accounts {...props} />}
          </>
        )}
      </main>
      <nav className="tabbar" aria-label="Sections">
        {TABS.map(({ id, label, Icon }) => (
          <button key={id} className={tab === id ? "tab active" : "tab"} aria-current={tab === id ? "page" : undefined} onClick={() => go(id)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}
