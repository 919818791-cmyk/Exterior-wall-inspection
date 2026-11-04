import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";

interface Props {
  start: string;
  end: string;
  onChange: (start: string, end: string) => void;
}

function todayInShanghai() {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(new Date());
  return ["year", "month", "day"].map((type) => parts.find((part) => part.type === type)?.value).join("-");
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function PhotoDateRangeFilter({ start, end, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const [draftStart, setDraftStart] = useState(start);
  const [draftEnd, setDraftEnd] = useState(end);
  const [month, setMonth] = useState(() => new Date(`${start || todayInShanghai()}T12:00:00`));
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const calendar = useRef<HTMLDivElement>(null);
  const id = useId();
  const today = todayInShanghai();

  function close() {
    setOpen(false);
    trigger.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    calendar.current?.querySelector<HTMLButtonElement>(`button[data-date="${draftStart || today}"]`)?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
    // Focus once when opening; selecting dates should preserve the clicked cell.
  }, [open]);

  function choose(value: string) {
    if (!draftStart || draftEnd) {
      setDraftStart(value);
      setDraftEnd("");
    } else {
      setDraftStart(value < draftStart ? value : draftStart);
      setDraftEnd(value < draftStart ? draftStart : value);
    }
  }

  function moveMonth(offset: number) {
    setMonth(new Date(month.getFullYear(), month.getMonth() + offset, 1, 12));
  }

  const first = new Date(month.getFullYear(), month.getMonth(), 1, 12);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const days = Array.from({ length: Math.ceil((offset + count) / 7) * 7 }, (_, index) => (
    new Date(month.getFullYear(), month.getMonth(), index - offset + 1, 12)
  ));

  return <div className="photo-library-field photo-library-date-range" ref={root}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}
    onKeyDown={(event) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } }}>
    <span id={`${id}-label`}>上传日期</span>
    <button aria-labelledby={`${id}-label ${id}-value`} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined}
      ref={trigger} type="button" onClick={() => {
        if (open) { close(); return; }
        setDraftStart(start); setDraftEnd(end);
        setMonth(new Date(`${start || end || today}T12:00:00`));
        setOpen(true);
      }}>
      <span id={`${id}-value`} className={start ? "" : "is-placeholder"}>{start ? `${start} — ${end}` : "开始日期 — 结束日期"}</span>
      <CalendarDays aria-hidden="true" />
    </button>
    {open ? <div className="photo-library-date-popover" id={id} role="dialog" aria-label="选择上传日期范围">
      <div className="photo-library-date-heading">
        <button aria-label="上个月" onClick={() => moveMonth(-1)} type="button"><ChevronLeft aria-hidden="true" /></button>
        <strong aria-live="polite">{month.getFullYear()}年 {month.getMonth() + 1}月</strong>
        <button aria-label="下个月" onClick={() => moveMonth(1)} type="button"><ChevronRight aria-hidden="true" /></button>
      </div>
      <p className="photo-library-date-instruction" aria-live="polite">{draftEnd ? "已选择日期范围" : draftStart ? "请选择结束日期" : "请选择开始日期"}</p>
      <div className="photo-library-date-calendar" ref={calendar}>
        {["一", "二", "三", "四", "五", "六", "日"].map((day) => <span key={day} aria-hidden="true">{day}</span>)}
        {days.map((date) => {
          const value = dateKey(date);
          const selected = value === draftStart || value === draftEnd;
          const inRange = draftStart && draftEnd && value > draftStart && value < draftEnd;
          return <button aria-label={value} aria-pressed={selected} aria-current={value === today ? "date" : undefined}
            className={[selected ? "is-endpoint" : "", inRange ? "is-in-range" : "", date.getMonth() !== month.getMonth() ? "is-adjacent-month" : ""].filter(Boolean).join(" ")}
            data-date={value} key={value} onClick={() => choose(value)} type="button">{date.getDate()}</button>;
        })}
      </div>
      <div className="photo-library-date-summary" aria-live="polite">{draftStart || "开始日期"} — {draftEnd || "结束日期"}</div>
      <div className="photo-library-date-actions">
        <button className="photo-library-text-button" type="button" onClick={() => { onChange("", ""); close(); }}>清除日期</button>
        <button className="primary-action-button" disabled={!draftStart || !draftEnd} type="button" onClick={() => { onChange(draftStart, draftEnd); close(); }}>确定</button>
      </div>
    </div> : null}
  </div>;
}
