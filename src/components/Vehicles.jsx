import { useState } from "react";
import Sheet from "./Sheet";
import { dateLabel, money, moneyWhole } from "../lib/format";
import { callFunction } from "../lib/supabase";

const STALE_DAYS = 90;
const daysSince = (iso) => Math.floor((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86400000);
const vehicleTitle = (d = {}) => [d.year, d.make, d.model].filter(Boolean).join(" ");

// Valuation sites: they need mileage and condition, which they ask for themselves
const VALUE_SITES = [
  { name: "Kelley Blue Book", url: "https://www.kbb.com/whats-my-car-worth/" },
  { name: "Edmunds", url: "https://www.edmunds.com/appraisal/" },
  { name: "Carvana offer", url: "https://www.carvana.com/sell-my-car" },
];

export default function Vehicles({ ledger }) {
  const { assets, accounts } = ledger;
  const [editing, setEditing] = useState(null); // asset or "new"
  const vehicles = assets.filter((a) => a.kind === "vehicle");
  const total = vehicles.filter((v) => !v.is_hidden).reduce((s, v) => s + Number(v.value), 0);

  return (
    <section className="block">
      <div className="block-head static">
        <h2>Vehicles</h2>
        {vehicles.length > 0 ? <span className="figure-sm">{money(total)}</span> : null}
      </div>
      {!vehicles.length && <p className="meta">Add your vehicles so their value counts toward net worth alongside any auto loans.</p>}
      <ul className="acct-list">
        {vehicles.map((v) => {
          const loan = accounts.find((a) => a.id === v.linked_account_id);
          const owed = loan ? Number(loan.current_balance ?? 0) : null;
          const stale = daysSince(v.value_updated_at) > STALE_DAYS;
          return (
            <li key={v.id}>
              <button className={`acct ${v.is_hidden ? "hidden" : ""}`} onClick={() => setEditing(v)}>
                <div className="tx-main">
                  <span className="tx-name">{v.name}</span>
                  <span className={`tx-sub ${stale ? "warn-text" : ""}`}>
                    {stale ? `Value is ${Math.round(daysSince(v.value_updated_at) / 30)} months old` : `Valued ${dateLabel(v.value_updated_at)}`}
                    {v.details?.mileage ? ` · ${Number(v.details.mileage).toLocaleString()} mi` : ""}
                  </span>
                </div>
                <div className="acct-right">
                  <span className="num">{money(v.value)}</span>
                  {owed != null && (
                    <span className={`tx-sub ${v.value - owed < 0 ? "neg" : "pos"}`}>
                      {v.value - owed < 0 ? `${moneyWhole(owed - v.value)} underwater` : `${moneyWhole(v.value - owed)} equity`}
                    </span>
                  )}
                </div>
              </button>
            </li>
          );
        })}
      </ul>
      <button className="btn-quiet wide" onClick={() => setEditing("new")}>Add vehicle</button>
      {editing && <VehicleSheet ledger={ledger} vehicle={editing === "new" ? null : editing} onClose={() => setEditing(null)} />}
    </section>
  );
}

function VehicleSheet({ ledger, vehicle, onClose }) {
  const { accounts, saveAsset, deleteAsset } = ledger;
  const d = vehicle?.details ?? {};
  const [vin, setVin] = useState(d.vin ?? "");
  const [year, setYear] = useState(d.year ? String(d.year) : "");
  const [make, setMake] = useState(d.make ?? "");
  const [model, setModel] = useState(d.model ?? "");
  const [trim, setTrim] = useState(d.trim ?? "");
  const [mileage, setMileage] = useState(d.mileage ? String(d.mileage) : "");
  const [extra, setExtra] = useState({ body: d.body, drive: d.drive, engine: d.engine, fuel: d.fuel });
  const [nickname, setNickname] = useState(vehicle && vehicle.name !== vehicleTitle(d) ? vehicle.name : "");
  const [value, setValue] = useState(vehicle ? String(vehicle.value) : "");
  const [valueChanged, setValueChanged] = useState(false);
  const [loanId, setLoanId] = useState(vehicle?.linked_account_id ?? "");
  const [hidden, setHidden] = useState(vehicle?.is_hidden ?? false);
  const [decoding, setDecoding] = useState(false);
  const [decoded, setDecoded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  const loans = accounts.filter((a) => a.type === "loan");
  const title = vehicleTitle({ year, make, model });

  async function decode() {
    setDecoding(true);
    setError(null);
    try {
      const r = await callFunction("vin-decode", { vin });
      setVin(r.vin);
      setYear(String(r.year));
      setMake(r.make);
      setModel(r.model);
      if (r.trim) setTrim(r.trim);
      setExtra({ body: r.body, drive: r.drive, engine: r.engine, fuel: r.fuel });
      setDecoded(true);
    } catch (e) {
      setError(e.message);
    } finally {
      setDecoding(false);
    }
  }

  async function copyVin() {
    try { await navigator.clipboard.writeText(vin); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard unavailable */ }
  }

  async function save() {
    const v = Number(String(value).replace(/[$,]/g, ""));
    if (!make.trim() || !model.trim()) return setError("Add at least the make and model, or look up the VIN.");
    if (!Number.isFinite(v) || v < 0) return setError("Enter the vehicle’s estimated value.");
    setBusy(true);
    setError(null);
    try {
      await saveAsset({
        ...(vehicle ? { id: vehicle.id } : {}),
        kind: "vehicle",
        name: nickname.trim() || title || "Vehicle",
        value: v,
        ...(!vehicle || valueChanged ? { value_updated_at: new Date().toLocaleDateString("en-CA"), value_source: "manual" } : {}),
        details: {
          vin: vin || null, year: year ? Number(year) : null, make: make.trim(), model: model.trim(), trim: trim.trim() || null,
          mileage: mileage ? Number(String(mileage).replace(/[,\s]/g, "")) : null, ...extra,
        },
        linked_account_id: loanId || null,
        is_hidden: hidden,
      });
      onClose();
    } catch (e) {
      setError(e.message);
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Remove ${vehicle.name}?`)) return;
    setBusy(true);
    try { await deleteAsset(vehicle.id); onClose(); } catch (e) { setError(e.message); setBusy(false); }
  }

  const specs = [trim, extra.engine, extra.drive, extra.body].filter(Boolean).join(" · ");

  return (
    <Sheet title={vehicle ? vehicle.name : "Add vehicle"} onClose={onClose}>
      <div className="field">
        <span>VIN</span>
        <div className="inline-input">
          <input
            value={vin}
            onChange={(e) => { setVin(e.target.value.toUpperCase()); setDecoded(false); }}
            placeholder="17 characters, on your registration or insurance card"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            maxLength={17}
          />
          <button className="btn-quiet" onClick={decode} disabled={decoding || vin.replace(/\s/g, "").length !== 17}>{decoding ? "Looking up…" : "Look up"}</button>
        </div>
        {decoded && <span className="form-info">Found: {title}{specs ? ` · ${specs}` : ""}</span>}
      </div>

      <div className="field-row">
        <label className="field">Year<input inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, "").slice(0, 4))} placeholder="2021" /></label>
        <label className="field">Make<input value={make} onChange={(e) => setMake(e.target.value)} placeholder="Ford" /></label>
      </div>
      <div className="field-row">
        <label className="field">Model<input value={model} onChange={(e) => setModel(e.target.value)} placeholder="F-150" /></label>
        <label className="field">Trim<input value={trim} onChange={(e) => setTrim(e.target.value)} placeholder="Optional" /></label>
      </div>
      <label className="field">Mileage<input inputMode="numeric" value={mileage} onChange={(e) => setMileage(e.target.value)} placeholder="Current odometer" /></label>

      <div className="value-box">
        <label className="field">
          Estimated value
          <input inputMode="decimal" value={value} onChange={(e) => { setValue(e.target.value); setValueChanged(true); }} placeholder="$0" />
        </label>
        {vehicle && <span className="meta">Last updated {dateLabel(vehicle.value_updated_at)}</span>}
        <p className="meta">Get a current estimate from one of these, then enter the private-party or trade-in value here.{vin.length === 17 ? " Copy your VIN to paste in." : ""}</p>
        <div className="chips">
          {vin.length === 17 && <button type="button" className="chip" onClick={copyVin}>{copied ? "Copied" : "Copy VIN"}</button>}
          {VALUE_SITES.map((s) => (
            <a key={s.name} className="chip" href={s.url} target="_blank" rel="noopener noreferrer">{s.name} ↗</a>
          ))}
        </div>
      </div>

      <label className="field">
        Loan on this vehicle
        <select value={loanId} onChange={(e) => setLoanId(e.target.value)}>
          <option value="">None / paid off</option>
          {loans.map((a) => <option key={a.id} value={a.id}>{a.nickname || a.name} ({money(a.current_balance)})</option>)}
        </select>
      </label>
      <label className="field">Nickname<input value={nickname} onChange={(e) => setNickname(e.target.value)} placeholder={title || "e.g. Work truck"} /></label>
      <label className="toggle"><input type="checkbox" checked={hidden} onChange={(e) => setHidden(e.target.checked)} /><span>Leave out of net worth</span></label>

      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="btn-primary" onClick={save} disabled={busy}>{busy ? "Saving…" : vehicle ? "Save changes" : "Add vehicle"}</button>
      {vehicle && <button className="btn-text danger" onClick={remove} disabled={busy}>Remove vehicle</button>}
    </Sheet>
  );
}
