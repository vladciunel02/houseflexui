import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  PAST_MONTH_SAVED_LEI,
  YESTERDAY_SAVED_LEI,
  hhmm,
  snapshot,
  type House,
  type Sim,
  type Snapshot,
} from '../data/mockFleet';
import {
  batteryRowBands,
  cancelledStrategy,
  estimatedFullMinute,
  savingsBreakdown,
} from '../data/derive';
import { useMinute, prefersReducedMotion } from '../state/time';
import { HouseScene } from '../scene/HouseScene';
import { Num, fmt } from '../ui/Num';
import { DaySchedule } from '../ui/DaySchedule';

interface Props {
  today: House;
  tomorrow: House;
  activeSim: Sim;
  cancelledAtMin: number | null;
  cloudStart: number | null;
  onConfirmCancel: (atMinute: number) => void;
  onReactivate: () => void;
}

function fmtSignedLei(v: number): string {
  if (Math.abs(v) < 0.005) return '+0,00';
  return v > 0 ? `+${fmt(v, 2)}` : fmt(v, 2);
}

function computeNextLine(today: House, sim: Sim, minute: number): string {
  const curH = minute / 60;
  const bands = batteryRowBands(today, sim);

  // Look for the next active battery change ("încarcă din soare" or "folosește în casă") after curH
  for (const b of bands) {
    if (b.start > curH + 0.01) {
      if (b.battery === 'încarcă din soare') {
        return `Urmează: la ${hhmm(b.start * 60)} încarcă bateria din soare`;
      }
      if (b.battery === 'folosește în casă') {
        return `Urmează: la ${hhmm(b.start * 60)} folosește bateria în casă`;
      }
    }
  }

  // During evening discharge, report when reserve hold begins
  const currentBand = bands.find((b) => curH >= b.start && curH < b.end);
  if (currentBand?.battery === 'folosește în casă' && currentBand.end < 24) {
    return `Urmează: la ${hhmm(currentBand.end * 60)} păstrează rezerva de 20 %`;
  }

  return 'Urmează: mâine dimineață vinde surplusul din soare';
}

function computeTargetLine(today: House, sim: Sim, minute: number): string {
  const fullMin = estimatedFullMinute(today, sim);
  if (fullMin == null) {
    return 'Ținta pentru baterie este 100 % până la 17:00';
  }
  if (minute < fullMin) {
    return `Bateria e plină la ~${hhmm(fullMin)}, ținta e 17:00`;
  }
  if (minute < 18 * 60) {
    return `Bateria a ajuns la 100 % la ~${hhmm(fullMin)}, ținta era 17:00`;
  }
  return 'Rezerva păstrată peste noapte este 20 % (2 kWh)';
}

export function HouseView({
  today,
  tomorrow,
  activeSim,
  cancelledAtMin,
  cloudStart,
  onConfirmCancel,
  onReactivate,
}: Props) {
  const minute = useMinute();
  const s = snapshot(today, activeSim, minute);
  const [resetSignal, setResetSignal] = useState(0);
  const resetLinkRef = useRef<HTMLDivElement>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [toast, setToast] = useState(false);
  const reduced = prefersReducedMotion();

  useEffect(() => {
    if (cancelledAtMin != null) {
      setConfirmingCancel(false);
    }
  }, [cancelledAtMin]);

  useEffect(() => {
    if (cloudStart == null) return;
    setToast(true);
    const t = setTimeout(() => setToast(false), 3600);
    return () => clearTimeout(t);
  }, [cloudStart]);

  const breakdown = useMemo(
    () => savingsBreakdown(today, activeSim, cloudStart),
    [today, activeSim, cloudStart],
  );

  // Preview exact lei lost if the user cancels at the current simulated minute
  const nowRoundedMin = Math.round(minute);
  const previewCancelledBreakdown = useMemo(() => {
    const previewSim = cancelledStrategy(today, nowRoundedMin, cloudStart);
    return savingsBreakdown(today, previewSim, cloudStart);
  }, [today, nowRoundedMin, cloudStart]);

  const cancelLossLei = Math.max(
    0,
    Math.round((breakdown.totalLei - previewCancelledBreakdown.totalLei) * 100) / 100,
  );

  const monthTotalLei = Math.round((PAST_MONTH_SAVED_LEI + breakdown.totalLei) * 100) / 100;
  const nextLine = useMemo(() => computeNextLine(today, activeSim, minute), [today, activeSim, minute]);
  const targetLine = useMemo(() => computeTargetLine(today, activeSim, minute), [today, activeSim, minute]);

  return (
    <div className="client-page">
      <div className="hero-grid">
        {/* ---------- 1. "Acum" block (top on mobile, top-right on desktop) ---------- */}
        <section className="info-block acum-block" aria-label="Starea bateriei acum">
          <div className="field-label">Acum</div>
          {cancelledAtMin != null ? (
            <>
              <p className="lead-sentence acum-lead tnum">
                Ai anulat decizia de azi la <strong>{hhmm(cancelledAtMin)}</strong>. HomeFlex revine mâine.
              </p>
              <p className="body-secondary acum-why">
                Până la miezul nopții bateria funcționează pe setările obișnuite.
              </p>
              <div className="acum-reactivate">
                <button type="button" className="btn-tertiary" onClick={onReactivate}>
                  Reactivează acum
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="lead-sentence acum-lead">
                <AcumWhatSentence s={s} />
              </p>
              <p className="body-secondary acum-why">
                <AcumWhySentence s={s} minute={minute} />
              </p>
              <div className="acum-meta tnum">
                <p>{nextLine}</p>
                <p className="acum-target">{targetLine}</p>
              </div>
            </>
          )}
        </section>

        {/* ---------- 2. 3D House Stage (left 58% on desktop; under "Acum" at 320px on mobile) ---------- */}
        <div className="scene-stage">
          <HouseScene
            house={today}
            sim={activeSim}
            cloudStart={cloudStart}
            resetSignal={resetSignal}
            avoidRef={resetLinkRef}
          />

          <div className="scene-bottom" ref={resetLinkRef}>
            <button
              type="button"
              className="btn-tertiary"
              onClick={() => setResetSignal((n) => n + 1)}
            >
              Resetează vederea
            </button>
          </div>

          <AnimatePresence>
            {toast && (
              <motion.div
                className="scene-toast"
                initial={{ opacity: 0, y: reduced ? 0 : -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: reduced ? 0 : 0.2, ease: 'easeOut' }}
                role="status"
              >
                Un nor acoperă panourile timp de 45 de minute. Planul s-a actualizat.
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ---------- 3. "Bani" block ---------- */}
        <section className="info-block bani-block" aria-label="Economii în lei">
          <div className="field-label">Bani</div>
          <div className="bani-hero tnum">
            <strong>
              {breakdown.totalLei >= -0.004 ? '+' : ''}
              <Num value={breakdown.totalLei} digits={2} /> lei azi
            </strong>
          </div>
          <p className="bani-sub">față de bateria fără HomeFlex</p>

          <div className="bani-breakdown tnum">
            <p>
              <strong>{fmtSignedLei(breakdown.dinVanzareaSurplusuluiDimineata)} lei</strong> din vânzarea
              surplusului dimineața
            </p>
            <p>
              <strong>{fmtSignedLei(breakdown.dinConsumulAcoperitSeara)} lei</strong> din consumul acoperit
              seara
            </p>
          </div>

          <p className="bani-history tnum">
            Ieri: <strong>+{fmt(YESTERDAY_SAVED_LEI, 2)} lei</strong> · Luna aceasta:{' '}
            <strong>+{fmt(monthTotalLei, 2)} lei</strong>
          </p>
        </section>

        {/* ---------- 4. Single Client Action: Cancel Today's Decision ---------- */}
        {cancelledAtMin == null && (
          <div className="info-block action-block">
            {!confirmingCancel ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setConfirmingCancel(true)}
              >
                Anulează decizia de azi
              </button>
            ) : (
              <div className="cancel-confirm" role="region" aria-label="Confirmare anulare decizie">
                <p className="cancel-confirm-text tnum">
                  Bateria trece pe setările obișnuite până la miezul nopții. Pierzi aproximativ{' '}
                  <strong>{fmt(cancelLossLei, 2)} lei</strong> azi.
                </p>
                <div className="cancel-confirm-actions">
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      setConfirmingCancel(false);
                      onConfirmCancel(nowRoundedMin);
                    }}
                  >
                    Confirmă
                  </button>
                  <button
                    type="button"
                    className="btn-tertiary"
                    onClick={() => setConfirmingCancel(false)}
                  >
                    Renunță
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ---------- Full-Width Battery Plan ("Planul bateriei") ---------- */}
      <DaySchedule
        today={today}
        tomorrow={tomorrow}
        activeTodaySim={activeSim}
        cloudStart={cloudStart}
      />
    </div>
  );
}

function AcumWhatSentence({ s }: { s: Snapshot }) {
  if (s.charge > 0.02) {
    return (
      <>
        Bateria se încarcă acum din soare și este la{' '}
        <strong>
          <Num value={s.socPct} digits={0} /> %
        </strong>
        .
      </>
    );
  }
  if (s.discharge > 0.02) {
    return (
      <>
        Bateria acoperă acum consumul casei și mai are{' '}
        <strong>
          <Num value={s.socPct} digits={0} /> %
        </strong>
        .
      </>
    );
  }
  if (s.socPct >= 97) {
    return (
      <>
        Bateria este plină la{' '}
        <strong>
          <Num value={s.socPct} digits={0} /> %
        </strong>{' '}
        și păstrează energia pentru seară.
      </>
    );
  }
  if (s.exp > 0.04 && s.price > 0) {
    return (
      <>
        Casa vinde acum surplusul în rețea, iar bateria stă la{' '}
        <strong>
          <Num value={s.socPct} digits={0} /> %
        </strong>
        .
      </>
    );
  }
  return (
    <>
      Bateria așteaptă la{' '}
      <strong>
        <Num value={s.socPct} digits={0} /> %
      </strong>
      , iar casa ia curent din rețea.
    </>
  );
}

function AcumWhySentence({ s, minute }: { s: Snapshot; minute: number }) {
  if (s.charge > 0.02 && s.price < 0) {
    return (
      <>
        Prețul din rețea este <strong className="neg-text tnum">{fmt(s.price, 2)} lei/kWh</strong>, așa că
        energia solară intră în baterie în loc să plece fără plată în rețea.
      </>
    );
  }
  if (s.charge > 0.02) {
    return (
      <>
        Prețul acum este <strong className="tnum">{fmt(s.price, 2)} lei/kWh</strong>, iar panourile umplu
        bateria înainte de vârful de seară de <strong className="tnum">0,95 lei/kWh</strong>.
      </>
    );
  }
  if (s.discharge > 0.02) {
    return (
      <>
        Curentul din rețea costă acum <strong className="tnum">{fmt(s.price, 2)} lei/kWh</strong>, așa că
        locuința folosește energia strânsă peste zi în baterie.
      </>
    );
  }
  if (s.socPct >= 97) {
    return s.price < 0 ? (
      <>
        Prețul în rețea este <strong className="neg-text tnum">{fmt(s.price, 2)} lei/kWh</strong>, iar
        bateria plină păstrează toată energia pentru seara la <strong className="tnum">0,95 lei/kWh</strong>.
      </>
    ) : (
      <>
        Prețul acum este <strong className="tnum">{fmt(s.price, 2)} lei/kWh</strong>, iar bateria păstrează
        energia pentru intervalul 18:00–22:00 (<strong className="tnum">0,95 lei/kWh</strong>).
      </>
    );
  }
  if (s.exp > 0.04 && s.price > 0) {
    return (
      <>
        Rețeaua plătește acum <strong className="tnum">+{fmt(s.price, 2)} lei/kWh</strong>, iar bateria
        păstrează loc liber pentru prânz, când prețul coboară la{' '}
        <strong className="neg-text tnum">−0,10 lei/kWh</strong>.
      </>
    );
  }
  return minute < 7 * 60 ? (
    <>
      Prețul de noapte este <strong className="tnum">{fmt(s.price, 2)} lei/kWh</strong>. După răsărit casa
      vinde surplusul, iar la prânz încarcă bateria din soare.
    </>
  ) : (
    <>
      Prețul din rețea a coborât la <strong className="tnum">{fmt(s.price, 2)} lei/kWh</strong>, iar bateria
      păstrează rezerva minimă de 20 % peste noapte.
    </>
  );
}
