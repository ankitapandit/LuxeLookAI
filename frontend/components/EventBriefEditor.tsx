import { useMemo, useRef, useState } from "react";

export type EventBriefValues = {
  dressCode: string[];
  dressCodeOther: string;
  location: string;
  venue: string[];
  venueOther: string;
  timeOfDay: string;
  weather: string;
  purpose: string;
  purposeOther: string;
  styleMood: string;
  styleMoodOther: string;
  comfortOrFashion: string;
  duration: string;
  durationOther: string;
  audience: string;
  audienceOther: string;
  notes: string;
};

export function createDefaultEventBriefValues(): EventBriefValues {
  return {
    dressCode: [],
    dressCodeOther: "",
    location: "",
    venue: [],
    venueOther: "",
    timeOfDay: "",
    weather: "",
    purpose: "",
    purposeOther: "",
    styleMood: "",
    styleMoodOther: "",
    comfortOrFashion: "",
    duration: "",
    durationOther: "",
    audience: "",
    audienceOther: "",
    notes: "",
  };
}

const DRESS_CODE_OPTIONS = ["Casual", "Smart Casual", "Business Casual", "Cocktail", "Black Tie", "None", "Other"];
const LOCATION_OPTIONS = ["Indoor", "Outdoor", "Both"];
const VENUE_OPTIONS = [
  "Academic",
  "Aquarium",
  "Ballroom",
  "Bar",
  "Beach",
  "Boat",
  "Brewery",
  "Concert",
  "Conference",
  "Hotel",
  "Museum",
  "Other",
  "Park",
  "Resort",
  "Restaurant",
  "Rooftop",
  "Sports",
  "Stadium",
  "Theatre",
  "Travel",
  "Winery",
  "Zoo",
];
const TIME_OPTIONS = ["Daytime", "Evening", "Nighttime"];
const PURPOSE_OPTIONS = [
  "Wedding Guest",
  "Birthday",
  "Work Event",
  "Interview",
  "Date Night",
  "Dinner",
  "Party",
  "Vacation",
  "Travel",
  "Other",
];
const STYLE_OPTIONS = ["Minimalist", "Romantic", "Bold", "Elegant", "Classic", "Sexy", "Street Smart", "Other"];
const COMFORT_OPTIONS = ["Comfort", "Balanced", "Fashion"];
const DURATION_OPTIONS = ["Under 2 hours", "2-4 hours", "Half day", "All day", "Day to night", "Other"];
const AUDIENCE_OPTIONS = ["Solo", "Date", "Friends", "Family", "Colleagues", "Clients", "Other"];

function normalizeMultiValue(value: string[] | string | undefined | null): string[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string" && value.trim()) return [value];
  return [];
}

function OptionPills({
  value,
  onPick,
  options,
  getOptionLabel,
}: {
  value: string;
  onPick: (next: string) => void;
  options: string[];
  getOptionLabel?: (option: string) => string;
}) {
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {options.map((option) => {
        const selected = value === option;
        const label = getOptionLabel?.(option) || option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onPick(selected ? "" : option)}
            className="type-chip"
            aria-pressed={selected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "40px",
              border: `1px solid ${selected ? "rgba(232,196,138,1)" : "rgba(255,255,255,0.20)"}`,
              background: selected ? "linear-gradient(180deg, rgba(232,196,138,0.42), rgba(212,169,106,0.28))" : "rgba(255,255,255,0.08)",
              color: selected ? "#FFF9F1" : "#F0EBE2",
              borderRadius: "999px",
              padding: "8px 13px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: selected ? 700 : 500,
              whiteSpace: "nowrap",
              transition: "all 0.15s ease, transform 0.12s ease",
              boxShadow: selected ? "0 0 0 1px rgba(232,196,138,0.34) inset, 0 10px 22px rgba(212,169,106,0.22)" : "none",
              transform: selected ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            {selected ? "✓ " : ""}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function SelectControl({
  value,
  onPick,
  options,
  placeholder,
  selectedDisplayLabel,
}: {
  value: string;
  onPick: (next: string) => void;
  options: string[];
  placeholder: string;
  selectedDisplayLabel?: string;
}) {
  return (
    <select
      className="input"
      value={value}
      onChange={(e) => onPick(e.target.value)}
      style={{
        minHeight: "40px",
        background: "rgba(255,255,255,0.06)",
        color: "#F7F0E6",
        borderColor: "rgba(255,255,255,0.10)",
      }}
    >
      <option value="">{placeholder}</option>
      {value === "Other" && selectedDisplayLabel ? (
        <option value="Other">{selectedDisplayLabel}</option>
      ) : null}
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function summarizeMultiSelectionForDisplay(values: string[], other: string, placeholder: string): string {
  const summary = summarizeMultiValue(values, other);
  if (!summary) return placeholder;
  const parts = summary.split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length <= 2) return parts.join(", ");
  return `${parts.slice(0, 2).join(", ")} +${parts.length - 2}`;
}

function MultiSelectDropdown({
  value,
  onToggle,
  options,
  otherValue,
  onOtherChange,
  placeholder,
  otherPlaceholder,
  getOptionLabel,
}: {
  value: string[];
  onToggle: (next: string) => void;
  options: string[];
  otherValue: string;
  onOtherChange: (next: string) => void;
  placeholder: string;
  otherPlaceholder: string;
  getOptionLabel?: (option: string) => string;
}) {
  const selectedValues = normalizeMultiValue(value);
  const hasOther = selectedValues.includes("Other");
  const summary = summarizeMultiSelectionForDisplay(selectedValues, otherValue, placeholder);
  const detailsRef = useRef<HTMLDetailsElement | null>(null);

  return (
    <details
      ref={detailsRef}
      style={{
        width: "100%",
        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: "12px",
        background: "rgba(255,255,255,0.06)",
        overflow: "hidden",
      }}
    >
      <summary
        style={{
          listStyle: "none",
          cursor: "pointer",
          minHeight: "40px",
          padding: "10px 14px",
          color: "#F7F0E6",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "12px",
          fontSize: "14px",
        }}
      >
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{summary}</span>
        <span style={{ color: "rgba(247,240,230,0.68)", fontSize: "12px" }}>▾</span>
      </summary>
      <div style={{ display: "grid", gap: "8px", padding: "0 12px 12px" }}>
        {options.map((option) => {
          const selected = selectedValues.includes(option);
          const label = getOptionLabel?.(option) || option;
          return (
            <button
              key={option}
              type="button"
              onClick={() => onToggle(option)}
              aria-pressed={selected}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "10px",
                minHeight: "40px",
                borderRadius: "10px",
                border: `1px solid ${selected ? "rgba(232,196,138,0.9)" : "rgba(255,255,255,0.10)"}`,
                background: selected ? "rgba(212,169,106,0.18)" : "rgba(255,255,255,0.03)",
                color: "#F7F0E6",
                padding: "8px 12px",
                textAlign: "left",
                cursor: "pointer",
                fontSize: "13px",
              }}
            >
              <span>{label}</span>
              <span style={{ color: selected ? "var(--gold-light)" : "rgba(247,240,230,0.35)" }}>{selected ? "✓" : ""}</span>
            </button>
          );
        })}
        {hasOther ? (
          <InlineOtherInput
            value={otherValue}
            onChange={onOtherChange}
            placeholder={otherPlaceholder}
            onCommit={() => detailsRef.current?.removeAttribute("open")}
          />
        ) : null}
      </div>
    </details>
  );
}

function MultiOptionPills({
  value,
  onToggle,
  options,
  getOptionLabel,
}: {
  value: string[];
  onToggle: (next: string) => void;
  options: string[];
  getOptionLabel?: (option: string) => string;
}) {
  const selectedValues = normalizeMultiValue(value);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
      {options.map((option) => {
        const selected = selectedValues.includes(option);
        const label = getOptionLabel?.(option) || option;
        return (
          <button
            key={option}
            type="button"
            onClick={() => onToggle(option)}
            className="type-chip"
            aria-pressed={selected}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "40px",
              border: `1px solid ${selected ? "rgba(232,196,138,1)" : "rgba(255,255,255,0.20)"}`,
              background: selected ? "linear-gradient(180deg, rgba(232,196,138,0.42), rgba(212,169,106,0.28))" : "rgba(255,255,255,0.08)",
              color: selected ? "#FFF9F1" : "#F0EBE2",
              borderRadius: "999px",
              padding: "8px 13px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: selected ? 700 : 500,
              whiteSpace: "nowrap",
              transition: "all 0.15s ease, transform 0.12s ease",
              boxShadow: selected ? "0 0 0 1px rgba(232,196,138,0.34) inset, 0 10px 22px rgba(212,169,106,0.22)" : "none",
              transform: selected ? "translateY(-1px)" : "translateY(0)",
            }}
          >
            {selected ? "✓ " : ""}
            {label}
          </button>
        );
      })}
    </div>
  );
}

function InlineOtherInput({
  value,
  onChange,
  placeholder,
  onCommit,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  onCommit?: () => void;
}) {
  return (
    <input
      className="input"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onBlur={() => {
        if (value.trim()) onCommit?.();
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          e.preventDefault();
          onCommit?.();
          (e.currentTarget as HTMLInputElement).blur();
        }
      }}
      placeholder={placeholder}
      style={{
        background: "rgba(255,255,255,0.06)",
        color: "#F7F0E6",
        borderColor: "rgba(255,255,255,0.10)",
        flex: "1 1 220px",
        minWidth: "200px",
      }}
    />
  );
}

function FieldShell({
  label,
  hint,
  children,
  stackOnMobile = false,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  stackOnMobile?: boolean;
}) {
  return (
    <div
      className={stackOnMobile ? "event-brief-field-shell event-brief-field-shell-stack" : "event-brief-field-shell"}
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(120px, 140px) minmax(0, 1fr)",
        gap: "12px",
        alignItems: "start",
      }}
    >
      <div style={{ display: "grid", gap: "2px" }}>
        <span style={{ fontSize: "13px", fontWeight: 700, color: "#FFF7ED" }}>
          {label}:
        </span>
        {hint ? (
          <span style={{ fontSize: "11px", color: "rgba(247,240,230,0.62)", fontStyle: "italic", lineHeight: 1.45 }}>
            {hint}
          </span>
        ) : null}
      </div>

      <div style={{ minWidth: 0 }}>
        {children}
      </div>
    </div>
  );
}

function TextEntry({
  value,
  onChange,
  placeholder,
  samples,
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  samples?: string[];
}) {
  return (
    <div style={{ display: "grid", gap: "8px" }}>
      <input
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        style={{
          background: "rgba(255,255,255,0.06)",
          color: "#F7F0E6",
          borderColor: "rgba(255,255,255,0.10)",
          minHeight: "40px",
          paddingTop: "10px",
          paddingBottom: "10px",
        }}
      />
      {!value.trim() && samples?.length ? (
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          {samples.map((sample) => (
            <button
              key={sample}
              type="button"
              onClick={() => onChange(sample)}
              style={{
                border: "1px solid rgba(255,255,255,0.08)",
                background: "rgba(255,255,255,0.03)",
                color: "rgba(247,240,230,0.72)",
                borderRadius: "999px",
                padding: "6px 10px",
                fontSize: "12px",
                cursor: "pointer",
                fontStyle: "italic",
              }}
            >
              {sample}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function summarizeValue(value: string, other: string): string {
  if (value === "Other") return other.trim();
  if (value === "None") return "";
  return value.trim();
}

function summarizeMultiValue(values: string[], other: string): string {
  const normalized = normalizeMultiValue(values);
  const picked = normalized.filter((value) => value && value !== "Other");
  if (normalized.includes("Other") && other.trim()) picked.push(other.trim());
  return picked.join(", ");
}

function formatWithAnd(parts: string[]): string {
  const filtered = parts.map((part) => part.trim()).filter(Boolean);
  if (filtered.length === 0) return "";
  if (filtered.length === 1) return filtered[0];
  if (filtered.length === 2) return `${filtered[0]} and ${filtered[1]}`;
  return `${filtered.slice(0, -1).join(", ")}, and ${filtered[filtered.length - 1]}`;
}

export function summarizeEventBrief(values: EventBriefValues, fallback = "Event styling request"): string {
  const dressCode = summarizeMultiValue(values.dressCode, values.dressCodeOther);
  const location = values.location.trim();
  const venue = summarizeMultiValue(values.venue, values.venueOther);
  const weather = values.weather.trim();
  const timeOfDay = values.timeOfDay.trim();
  const purpose = summarizeValue(values.purpose, values.purposeOther);
  const comfort = values.comfortOrFashion.trim();
  const duration = summarizeValue(values.duration, values.durationOther);
  const audienceValue = summarizeValue(values.audience, values.audienceOther);
  const mood = summarizeValue(values.styleMood, values.styleMoodOther);

  const openingParts = [dressCode, location, venue, purpose].filter(Boolean);
  const opening = formatWithAnd(openingParts);

  const detailParts = [
    weather,
    timeOfDay,
    comfort ? `${comfort.toLowerCase()}-first` : "",
    duration,
    mood,
  ].filter(Boolean);
  const detail = formatWithAnd(detailParts);

  const audienceClause = audienceValue ? `with ${audienceValue.toLowerCase()}` : "";

  const sentenceParts = [
    opening,
    audienceClause,
    detail ? `for ${detail.toLowerCase()}` : "",
  ].filter(Boolean);

  const sentence = sentenceParts.join(" ").replace(/\s+/g, " ").trim();
  if (!sentence) return fallback;
  return sentence.charAt(0).toUpperCase() + sentence.slice(1);
}

export function serializeEventBrief(values: EventBriefValues): Record<string, unknown> {
  const cleaned = {
    dressCode: normalizeMultiValue(values.dressCode).filter((value) => value && value !== "Other"),
    dressCodeOther: values.dressCode.includes("Other") ? values.dressCodeOther.trim() : "",
    location: values.location.trim(),
    venue: normalizeMultiValue(values.venue).filter((value) => value && value !== "Other"),
    venueOther: values.venue.includes("Other") ? values.venueOther.trim() : "",
    timeOfDay: values.timeOfDay.trim(),
    weather: values.weather.trim(),
    purpose: values.purpose === "Other" ? "" : values.purpose.trim(),
    purposeOther: values.purpose === "Other" ? values.purposeOther.trim() : "",
    styleMood: values.styleMood === "Other" ? "" : values.styleMood.trim(),
    styleMoodOther: values.styleMood === "Other" ? values.styleMoodOther.trim() : "",
    comfortOrFashion: values.comfortOrFashion.trim(),
    duration: values.duration === "Other" ? "" : values.duration.trim(),
    durationOther: values.duration === "Other" ? values.durationOther.trim() : "",
    audience: values.audience === "Other" ? "" : values.audience.trim(),
    audienceOther: values.audience === "Other" ? values.audienceOther.trim() : "",
    notes: values.notes.trim(),
  };

  return Object.fromEntries(
    Object.entries(cleaned).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0;
      return Boolean(value);
    }),
  );
}

export function composeEventBriefText(
  rawText: string,
  values: EventBriefValues,
  fallbackPrompt = "Event styling request",
): string {
  const lines: string[] = [];

  const push = (label: string, value?: string) => {
    const trimmed = (value || "").trim();
    if (!trimmed) return;
    lines.push(`${label}: ${trimmed}`);
  };

  push("Dress Code", summarizeMultiValue(values.dressCode, values.dressCodeOther));
  push("Location", values.location);
  push("Venue", summarizeMultiValue(values.venue, values.venueOther));
  push("Time of Day", values.timeOfDay);
  push("Weather & Climate", values.weather);
  push("Purpose & Event Type", summarizeValue(values.purpose, values.purposeOther));
  push("Style & Mood", summarizeValue(values.styleMood, values.styleMoodOther));
  push("Comfort or Fashion First", values.comfortOrFashion);
  push("Duration", summarizeValue(values.duration, values.durationOther));
  push("Audience / Company", summarizeValue(values.audience, values.audienceOther));
  push("Notes", values.notes);

  const summary = summarizeEventBrief(values, fallbackPrompt);
  const parts = [summary, lines.length ? `Core Event Parameters:\n${lines.join("\n")}` : "", rawText.trim()]
    .filter(Boolean);

  return parts.join("\n\n") || fallbackPrompt;
}

export default function EventBriefEditor({
  values,
  onChange,
  onReset,
  mobileCompact = false,
}: {
  values: EventBriefValues;
  onChange: (next: EventBriefValues) => void;
  onReset?: () => void;
  mobileCompact?: boolean;
}) {
  const dressCodeValues = normalizeMultiValue(values.dressCode);
  const venueValues = normalizeMultiValue(values.venue);
  const [editingCustomSingle, setEditingCustomSingle] = useState<{ purpose: boolean; styleMood: boolean; duration: boolean; audience: boolean }>({
    purpose: false,
    styleMood: false,
    duration: false,
    audience: false,
  });

  const formHasOther = useMemo(() => ({
    dressCode: dressCodeValues.includes("Other"),
    venue: venueValues.includes("Other"),
    purpose: values.purpose === "Other",
    styleMood: values.styleMood === "Other",
    duration: values.duration === "Other",
    audience: values.audience === "Other",
  }), [dressCodeValues, venueValues, values.purpose, values.styleMood, values.duration, values.audience]);

  const setField = <K extends keyof EventBriefValues>(key: K, next: EventBriefValues[K]) => {
    onChange({ ...values, [key]: next });
  };

  const renderOtherLabel = (option: string, otherValue: string) =>
    option === "Other" && otherValue.trim() ? otherValue.trim() : option;

  const toggleMultiField = (key: "dressCode" | "venue", otherKey: "dressCodeOther" | "venueOther", next: string) => {
    const current = normalizeMultiValue(values[key]);
    const updated = current.includes(next)
      ? current.filter((item) => item !== next)
      : [...current, next];
    onChange({
      ...values,
      [key]: updated,
      [otherKey]: updated.includes("Other") ? values[otherKey] : "",
    });
  };

  const setPurpose = (next: string) => {
    setEditingCustomSingle((prev) => ({
      ...prev,
      purpose: next === "Other",
    }));
    onChange({
      ...values,
      purpose: next,
      purposeOther: next === "Other" ? values.purposeOther : "",
    });
  };

  const setStyleMood = (next: string) => {
    setEditingCustomSingle((prev) => ({
      ...prev,
      styleMood: next === "Other",
    }));
    onChange({
      ...values,
      styleMood: next,
      styleMoodOther: next === "Other" ? values.styleMoodOther : "",
    });
  };

  const setDuration = (next: string) => {
    setEditingCustomSingle((prev) => ({
      ...prev,
      duration: next === "Other",
    }));
    onChange({
      ...values,
      duration: next,
      durationOther: next === "Other" ? values.durationOther : "",
    });
  };

  const setAudience = (next: string) => {
    setEditingCustomSingle((prev) => ({
      ...prev,
      audience: next === "Other",
    }));
    onChange({
      ...values,
      audience: next,
      audienceOther: next === "Other" ? values.audienceOther : "",
    });
  };

  const handleReset = () => {
    onChange(createDefaultEventBriefValues());
    setEditingCustomSingle({
      purpose: false,
      styleMood: false,
      duration: false,
      audience: false,
    });
    onReset?.();
  };

  return (
    <section
      style={{
        marginTop: "16px",
      }}
    >
      <div style={{ display: "grid", gap: "14px" }}>
        <div style={{ display: "flex", justifyContent: "flex-end" }}>
          <button
            type="button"
            onClick={handleReset}
            style={{
              border: "none",
              background: "transparent",
              color: "rgba(247,240,230,0.62)",
              fontSize: "11px",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              cursor: "pointer",
              padding: 0,
            }}
          >
            Reset form
          </button>
        </div>
        <FieldShell label="Dress Code" hint="Choose one or more" stackOnMobile={mobileCompact}>
          {mobileCompact ? (
            <MultiSelectDropdown
              value={dressCodeValues}
              onToggle={(next) => toggleMultiField("dressCode", "dressCodeOther", next)}
              options={DRESS_CODE_OPTIONS}
              otherValue={values.dressCodeOther}
              onOtherChange={(next) => setField("dressCodeOther", next)}
              placeholder="Select dress code"
              otherPlaceholder="Describe the dress code"
              getOptionLabel={(option) => renderOtherLabel(option, values.dressCodeOther)}
            />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
              <MultiOptionPills
                value={dressCodeValues}
                onToggle={(next) => toggleMultiField("dressCode", "dressCodeOther", next)}
                options={DRESS_CODE_OPTIONS}
                getOptionLabel={(option) => renderOtherLabel(option, values.dressCodeOther)}
              />
              {formHasOther.dressCode ? (
                <InlineOtherInput
                  value={values.dressCodeOther}
                  onChange={(next) => setField("dressCodeOther", next)}
                  placeholder="Describe the dress code"
                />
              ) : null}
            </div>
          )}
        </FieldShell>

        <FieldShell label="Location" hint="Indoor / outdoor / both" stackOnMobile={mobileCompact}>
          {mobileCompact ? (
            <>
              <div className="desktop-only-choice">
                <OptionPills value={values.location} onPick={(next) => setField("location", next)} options={LOCATION_OPTIONS} />
              </div>
              <div className="mobile-only-choice">
                <SelectControl
                  value={values.location}
                  onPick={(next) => setField("location", next)}
                  options={LOCATION_OPTIONS}
                  placeholder="Select location"
                />
              </div>
            </>
          ) : (
            <OptionPills value={values.location} onPick={(next) => setField("location", next)} options={LOCATION_OPTIONS} />
          )}
        </FieldShell>

        <FieldShell label="Venue" hint="Choose one or more" stackOnMobile={mobileCompact}>
          {mobileCompact ? (
            <MultiSelectDropdown
              value={venueValues}
              onToggle={(next) => toggleMultiField("venue", "venueOther", next)}
              options={VENUE_OPTIONS}
              otherValue={values.venueOther}
              onOtherChange={(next) => setField("venueOther", next)}
              placeholder="Select venue"
              otherPlaceholder="Describe the venue"
              getOptionLabel={(option) => renderOtherLabel(option, values.venueOther)}
            />
          ) : (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
              <MultiOptionPills
                value={venueValues}
                onToggle={(next) => toggleMultiField("venue", "venueOther", next)}
                options={VENUE_OPTIONS}
                getOptionLabel={(option) => renderOtherLabel(option, values.venueOther)}
              />
              {formHasOther.venue ? (
                <InlineOtherInput
                  value={values.venueOther}
                  onChange={(next) => setField("venueOther", next)}
                  placeholder="Describe the venue"
                />
              ) : null}
            </div>
          )}
        </FieldShell>

        <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
          <FieldShell label="Time of Day" hint="When the outfit will be seen" stackOnMobile={mobileCompact}>
            {mobileCompact ? (
              <>
                <div className="desktop-only-choice">
                  <OptionPills value={values.timeOfDay} onPick={(next) => setField("timeOfDay", next)} options={TIME_OPTIONS} />
                </div>
                <div className="mobile-only-choice">
                  <SelectControl
                    value={values.timeOfDay}
                    onPick={(next) => setField("timeOfDay", next)}
                    options={TIME_OPTIONS}
                    placeholder="Select time of day"
                  />
                </div>
              </>
            ) : (
              <OptionPills value={values.timeOfDay} onPick={(next) => setField("timeOfDay", next)} options={TIME_OPTIONS} />
            )}
          </FieldShell>

          <FieldShell label="Comfort or Fashion First" hint="What should lead?" stackOnMobile={mobileCompact}>
            {mobileCompact ? (
              <>
                <div className="desktop-only-choice">
                  <OptionPills value={values.comfortOrFashion} onPick={(next) => setField("comfortOrFashion", next)} options={COMFORT_OPTIONS} />
                </div>
                <div className="mobile-only-choice">
                  <SelectControl
                    value={values.comfortOrFashion}
                    onPick={(next) => setField("comfortOrFashion", next)}
                    options={COMFORT_OPTIONS}
                    placeholder="Select priority"
                  />
                </div>
              </>
            ) : (
              <OptionPills value={values.comfortOrFashion} onPick={(next) => setField("comfortOrFashion", next)} options={COMFORT_OPTIONS} />
            )}
          </FieldShell>
        </div>

        <FieldShell label="Weather & Climate" hint="Temperature, rain, humidity, breeze" stackOnMobile={mobileCompact}>
          <TextEntry
            value={values.weather}
            onChange={(next) => setField("weather", next)}
            placeholder="e.g. 68°F, breezy, light drizzle, air-conditioned indoors"
            samples={[
              "Breezy",
              "Air conditioned",
              "Drizzle",
              "Rainy",
              "Overcast",
            ]}
          />
        </FieldShell>

        <details style={{ marginTop: "4px" }}>
          <summary
            style={{
              cursor: "pointer",
              listStyle: "none",
              fontSize: "12px",
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              color: "rgba(247,240,230,0.60)",
            }}
          >
            Optional details
          </summary>
          <div style={{ display: "grid", gap: "14px", marginTop: "14px" }}>
            <FieldShell label="Purpose & Event Type" hint="Choose a match or use Other" stackOnMobile={mobileCompact}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
                {mobileCompact ? (
                  <>
                    <div className="desktop-only-choice">
                      <OptionPills
                        value={values.purpose}
                        onPick={setPurpose}
                        options={PURPOSE_OPTIONS}
                        getOptionLabel={(option) => renderOtherLabel(option, values.purposeOther)}
                      />
                    </div>
                    <div className="mobile-only-choice" style={{ flex: "1 1 220px", minWidth: "200px" }}>
                      <SelectControl
                        value={values.purpose}
                        onPick={setPurpose}
                        options={PURPOSE_OPTIONS}
                        placeholder="Select event type"
                        selectedDisplayLabel={values.purpose === "Other" ? values.purposeOther.trim() || "Other" : undefined}
                      />
                    </div>
                  </>
                ) : (
                  <OptionPills
                    value={values.purpose}
                    onPick={setPurpose}
                    options={PURPOSE_OPTIONS}
                    getOptionLabel={(option) => renderOtherLabel(option, values.purposeOther)}
                  />
                )}
              {formHasOther.purpose && (!mobileCompact || editingCustomSingle.purpose || !values.purposeOther.trim()) ? (
                <InlineOtherInput
                  value={values.purposeOther}
                  onChange={(next) => setField("purposeOther", next)}
                  placeholder="Describe the event type"
                  onCommit={() => setEditingCustomSingle((prev) => ({ ...prev, purpose: false }))}
                />
              ) : null}
              </div>
            </FieldShell>

            <FieldShell label="Style & Mood" hint="The tone you want the look to give" stackOnMobile={mobileCompact}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
                {mobileCompact ? (
                  <>
                    <div className="desktop-only-choice">
                      <OptionPills
                        value={values.styleMood}
                        onPick={setStyleMood}
                        options={STYLE_OPTIONS}
                        getOptionLabel={(option) => renderOtherLabel(option, values.styleMoodOther)}
                      />
                    </div>
                    <div className="mobile-only-choice" style={{ flex: "1 1 220px", minWidth: "200px" }}>
                      <SelectControl
                        value={values.styleMood}
                        onPick={setStyleMood}
                        options={STYLE_OPTIONS}
                        placeholder="Select style mood"
                        selectedDisplayLabel={values.styleMood === "Other" ? values.styleMoodOther.trim() || "Other" : undefined}
                      />
                    </div>
                  </>
                ) : (
                  <OptionPills
                    value={values.styleMood}
                    onPick={setStyleMood}
                    options={STYLE_OPTIONS}
                    getOptionLabel={(option) => renderOtherLabel(option, values.styleMoodOther)}
                  />
                )}
              {formHasOther.styleMood && (!mobileCompact || editingCustomSingle.styleMood || !values.styleMoodOther.trim()) ? (
                  <InlineOtherInput
                    value={values.styleMoodOther}
                    onChange={(next) => setField("styleMoodOther", next)}
                    placeholder="Describe the mood"
                    onCommit={() => setEditingCustomSingle((prev) => ({ ...prev, styleMood: false }))}
                  />
                ) : null}
              </div>
            </FieldShell>

            <FieldShell label="Duration" hint="How long you’ll be there" stackOnMobile={mobileCompact}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
                {mobileCompact ? (
                  <>
                    <div className="desktop-only-choice">
                      <OptionPills
                        value={values.duration}
                        onPick={setDuration}
                        options={DURATION_OPTIONS}
                        getOptionLabel={(option) => renderOtherLabel(option, values.durationOther)}
                      />
                    </div>
                    <div className="mobile-only-choice" style={{ flex: "1 1 220px", minWidth: "200px" }}>
                      <SelectControl
                        value={values.duration}
                        onPick={setDuration}
                        options={DURATION_OPTIONS}
                        placeholder="Select duration"
                        selectedDisplayLabel={values.duration === "Other" ? values.durationOther.trim() || "Other" : undefined}
                      />
                    </div>
                  </>
                ) : (
                  <OptionPills
                    value={values.duration}
                    onPick={setDuration}
                    options={DURATION_OPTIONS}
                    getOptionLabel={(option) => renderOtherLabel(option, values.durationOther)}
                  />
                )}
                {formHasOther.duration && (!mobileCompact || editingCustomSingle.duration || !values.durationOther.trim()) ? (
                  <InlineOtherInput
                    value={values.durationOther}
                    onChange={(next) => setField("durationOther", next)}
                    placeholder="Describe the duration"
                    onCommit={() => setEditingCustomSingle((prev) => ({ ...prev, duration: false }))}
                  />
                ) : null}
              </div>
            </FieldShell>

            <FieldShell label="Audience / Company" hint="Who you’re dressing for" stackOnMobile={mobileCompact}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px", alignItems: "center", minHeight: "40px" }}>
                {mobileCompact ? (
                  <>
                    <div className="desktop-only-choice">
                      <OptionPills
                        value={values.audience}
                        onPick={setAudience}
                        options={AUDIENCE_OPTIONS}
                        getOptionLabel={(option) => renderOtherLabel(option, values.audienceOther)}
                      />
                    </div>
                    <div className="mobile-only-choice" style={{ flex: "1 1 220px", minWidth: "200px" }}>
                      <SelectControl
                        value={values.audience}
                        onPick={setAudience}
                        options={AUDIENCE_OPTIONS}
                        placeholder="Select audience"
                        selectedDisplayLabel={values.audience === "Other" ? values.audienceOther.trim() || "Other" : undefined}
                      />
                    </div>
                  </>
                ) : (
                  <OptionPills
                    value={values.audience}
                    onPick={setAudience}
                    options={AUDIENCE_OPTIONS}
                    getOptionLabel={(option) => renderOtherLabel(option, values.audienceOther)}
                  />
                )}
                {formHasOther.audience && (!mobileCompact || editingCustomSingle.audience || !values.audienceOther.trim()) ? (
                  <InlineOtherInput
                    value={values.audienceOther}
                    onChange={(next) => setField("audienceOther", next)}
                    placeholder="Describe the audience"
                    onCommit={() => setEditingCustomSingle((prev) => ({ ...prev, audience: false }))}
                  />
                ) : null}
              </div>
            </FieldShell>

            <FieldShell label="Additional Notes" hint="Anything else the styling should know" stackOnMobile={mobileCompact}>
              <TextEntry
                value={values.notes}
                onChange={(next) => setField("notes", next)}
                placeholder="Any extra context, preferences, or constraints"
                samples={["Prefer low heels", "Need pockets", "Open to bolder jewelry"]}
              />
            </FieldShell>
          </div>
        </details>
      </div>
    </section>
  );
}
