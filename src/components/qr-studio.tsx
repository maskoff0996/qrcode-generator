import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Share } from "lucide-react";
import type { QRCodeErrorCorrectionLevel } from "qrcode";

const MAX_CHARS = 2000;
const MIN_CONTRAST = 3;
const SIZE_MIN = 192;
const SIZE_MAX = 640;
const SIZE_STEP = 16;

const LEVELS: Array<{
  id: QRCodeErrorCorrectionLevel;
  title: string;
  detail: string;
}> = [
  { id: "L", title: "低（L）", detail: "约 7% 容错，容量最大" },
  { id: "M", title: "中（M）", detail: "约 15% 容错，日常使用" },
  { id: "Q", title: "较高（Q）", detail: "约 25% 容错" },
  { id: "H", title: "高（H）", detail: "约 30% 容错，容量最小" },
];

type Job = {
  text: string;
  foreground: string;
  background: string;
  size: number;
  level: QRCodeErrorCorrectionLevel;
};

type Tone = "muted" | "warn" | "danger";
type Notice = { text: string; tone: Tone };

export function QrStudio() {
  const baseId = useId();
  const payloadId = `${baseId}-payload`;
  const payloadHintId = `${baseId}-payload-hint`;
  const fgId = `${baseId}-fg`;
  const bgId = `${baseId}-bg`;
  const sizeId = `${baseId}-size`;
  const sizeHintId = `${baseId}-size-hint`;
  const eccHintId = `${baseId}-ecc-hint`;
  const previewHintId = `${baseId}-preview-hint`;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const draftRef = useRef("");
  const composingRef = useRef(false);

  const [text, setText] = useState("");
  const [truncated, setTruncated] = useState(false);
  const [foreground, setForeground] = useState("#000000");
  const [background, setBackground] = useState("#ffffff");
  const [size, setSize] = useState(320);
  const [level, setLevel] = useState<QRCodeErrorCorrectionLevel>("M");
  const [job, setJob] = useState<Job | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [saveNote, setSaveNote] = useState<string | null>(null);

  useEffect(() => {
    if (!job) return;
    let cancelled = false;
    setReady(false);
    setError(null);
    void (async () => {
      try {
        const QR = await import("qrcode");
        if (cancelled) return;
        const url = await QR.toDataURL(job.text, {
          errorCorrectionLevel: job.level,
          width: job.size,
          margin: 4,
          color: { dark: job.foreground, light: job.background },
        });
        if (cancelled) return;
        setImageUrl(url);
        setError(null);
        setReady(true);
      } catch (err) {
        if (cancelled) return;
        setImageUrl(null);
        setReady(false);
        setError(explainError(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  const contrast = useMemo(
    () => contrastRatio(job?.foreground ?? foreground, job?.background ?? background),
    [job, foreground, background],
  );
  const stale =
    job !== null &&
    (job.text !== text.trim() ||
      job.foreground !== foreground ||
      job.background !== background ||
      job.size !== size ||
      job.level !== level);
  const phase = job === null ? "idle" : !ready && !error ? "loading" : "done";

  const notice = useMemo(
    () => buildNotice({ text, error, phase, contrast, stale }),
    [text, error, phase, contrast, stale],
  );
  const [shown, setShown] = useState<Notice>(notice);

  useEffect(() => {
    if (notice.tone === "danger") {
      setShown(notice);
      return;
    }
    const handle = window.setTimeout(() => setShown(notice), 280);
    return () => window.clearTimeout(handle);
  }, [notice]);

  const altText = useMemo(() => {
    const compact = (job?.text ?? "").replace(/\s+/g, " ").trim();
    if (!compact) return "二维码";
    if (compact.length <= 80) return `二维码，内容：${compact}`;
    return `二维码，内容：${compact.slice(0, 80)}…`;
  }, [job]);

  function rememberField() {
    const raw = textareaRef.current?.value ?? "";
    if (raw) draftRef.current = raw;
    return raw || draftRef.current;
  }

  function updateText(next: string) {
    const clipped = next.length > MAX_CHARS ? next.slice(0, MAX_CHARS) : next;
    draftRef.current = clipped;
    if (textareaRef.current && textareaRef.current.value !== clipped) {
      textareaRef.current.value = clipped;
    }
    setText(clipped);
    setTruncated(next.length > MAX_CHARS);
  }

  function generate() {
    const typed = rememberField();
    const raw = typed.length > MAX_CHARS ? typed.slice(0, MAX_CHARS) : typed;
    if (textareaRef.current && textareaRef.current.value !== raw) {
      textareaRef.current.value = raw;
    }
    draftRef.current = raw;
    setText(raw);
    setTruncated(typed.length > MAX_CHARS);
    const payload = raw.trim();
    if (!payload) return;
    setJob({
      text: payload,
      foreground,
      background,
      size,
      level,
    });
    setSaveNote(null);
  }

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    const sync = () => {
      if (composingRef.current) return;
      const raw = el.value;
      if (!raw && draftRef.current) {
        el.value = draftRef.current;
        return;
      }
      const clipped = raw.length > MAX_CHARS ? raw.slice(0, MAX_CHARS) : raw;
      if (clipped !== raw) el.value = clipped;
      draftRef.current = clipped;
      setText((current) => (current === clipped ? current : clipped));
      setTruncated(raw.length > MAX_CHARS);
    };
    const onStart = () => {
      composingRef.current = true;
    };
    const onEnd = () => {
      composingRef.current = false;
      sync();
    };
    el.addEventListener("input", sync);
    el.addEventListener("change", sync);
    el.addEventListener("compositionstart", onStart);
    el.addEventListener("compositionend", onEnd);
    const timer = window.setInterval(sync, 300);
    return () => {
      el.removeEventListener("input", sync);
      el.removeEventListener("change", sync);
      el.removeEventListener("compositionstart", onStart);
      el.removeEventListener("compositionend", onEnd);
      window.clearInterval(timer);
    };
  }, []);

  async function saveOrShare() {
    if (!imageUrl) return;
    setSaveNote(null);
    let file: File;
    try {
      file = fileFromDataUrl(imageUrl);
    } catch {
      setSaveNote("没有弹出分享时，请长按二维码，选择“存储图像”。");
      return;
    }
    if (preferShareSheet()) {
      try {
        const payload = { files: [file], title: "二维码" };
        const allowed =
          typeof navigator.canShare !== "function" || navigator.canShare(payload);
        if (allowed && typeof navigator.share === "function") {
          await navigator.share(payload);
          return;
        }
      } catch (err) {
        if (isShareAbort(err)) return;
      }
      setSaveNote("没有弹出分享时，请长按二维码，选择“存储图像”。");
      return;
    }
    triggerDownload(file);
  }

  const toneClass =
    shown.tone === "danger" ? "text-danger" : shown.tone === "warn" ? "text-warn" : "text-muted";

  return (
    <main className="shell">
      <a
        href={`#${payloadId}`}
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-10 focus:bg-surface focus:px-3 focus:py-2"
      >
        跳到内容输入
      </a>
      <header className="mb-8 max-w-2xl">
        <p className="text-sm font-medium text-muted">只在本地生成，不会上传</p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight">二维码生成器</h1>
        <p className="mt-3 max-w-xl text-muted">
          写下网址或任意文字，点「生成」后才会出现对应的二维码。颜色、尺寸和纠错等级会一起生效，完成后可保存图片。
        </p>
      </header>

      <form
        className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,22rem)] lg:gap-8"
        onSubmit={(event) => {
          event.preventDefault();
          generate();
        }}
      >
          <div className="panel order-1 flex flex-col gap-4 lg:col-start-1 lg:row-start-1">
            <div className="flex items-center justify-between gap-3">
              <label htmlFor={payloadId} className="font-medium">
                内容
              </label>
              <button type="button" className="btn btn-ghost" onClick={() => updateText("")}>
                清空
              </button>
            </div>
            <textarea
              ref={textareaRef}
              id={payloadId}
              className="field"
              defaultValue=""
              onCompositionStart={() => {
                composingRef.current = true;
              }}
              onCompositionEnd={(event) => {
                composingRef.current = false;
                updateText(event.currentTarget.value);
              }}
              onInput={(event) => {
                draftRef.current = event.currentTarget.value;
                if (composingRef.current) return;
                updateText(event.currentTarget.value);
              }}
              placeholder="写下网址或任意文字，例如 https://example.com"
              aria-describedby={payloadHintId}
              autoComplete="off"
              spellCheck
            />
            <p id={payloadHintId} className="text-sm text-muted">
              <span className="tabular-nums">
                {text.length} / {MAX_CHARS}
              </span>{" "}
              个字符。支持网址、中文和普通文本。
              {truncated ? " 超出的部分已截断。" : null}
            </p>
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={phase === "loading"}
              onPointerDown={rememberField}
              onClick={generate}
            >
              {phase === "loading" ? "正在生成…" : "生成二维码"}
            </button>
          </div>

          <section
            className="panel order-2 flex flex-col gap-4 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start"
            aria-labelledby={`${baseId}-preview-title`}
          >
            <h2 id={`${baseId}-preview-title`} className="text-lg font-semibold">
              预览
            </h2>
            <div
              className="grid aspect-square w-full place-items-center overflow-hidden rounded-sm border border-line bg-wash"
              aria-busy={phase === "loading"}
            >
              {imageUrl ? (
                <img
                  src={imageUrl}
                  width={job?.size ?? size}
                  height={job?.size ?? size}
                  alt={altText}
                  className="qr-image"
                  aria-describedby={previewHintId}
                  draggable={false}
                />
              ) : (
                <p className="px-6 text-center text-sm text-muted">
                  {error ? "暂时无法显示二维码" : "写下内容并点「生成」，二维码会出现在这里"}
                </p>
              )}
            </div>
            <p id={previewHintId} className="text-sm text-muted">
              图案四周的留白已包含在图片里，打印或转发时请保留。可以对着屏幕试扫。
            </p>
            <p role="status" aria-live="polite" aria-atomic="true" className={`min-h-6 text-sm ${toneClass}`}>
              {shown.text}
            </p>
            <button type="button" className="btn btn-primary w-full" onClick={() => void saveOrShare()} disabled={!imageUrl}>
              <Share className="size-4" strokeWidth={2} aria-hidden="true" />
              保存图片
            </button>
            <p className="text-sm text-muted">
              手机会弹出系统分享，可以存到相册或发给别人。电脑会直接下载 PNG。
              {saveNote ? <span className="mt-1 block text-warn">{saveNote}</span> : null}
            </p>
          </section>

          <div className="panel order-3 flex flex-col gap-6 lg:col-start-1 lg:row-start-2">
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField id={fgId} label="前景色" value={foreground} onChange={setForeground} />
              <ColorField id={bgId} label="背景色" value={background} onChange={setBackground} />
            </div>

            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between gap-3">
                <label htmlFor={sizeId} className="font-medium">
                  尺寸
                </label>
                <output htmlFor={sizeId} className="tabular-nums text-sm text-muted">
                  {size} × {size} 像素
                </output>
              </div>
              <input
                id={sizeId}
                className="range"
                type="range"
                min={SIZE_MIN}
                max={SIZE_MAX}
                step={SIZE_STEP}
                value={size}
                onChange={(event) => setSize(Number(event.target.value))}
                aria-valuemin={SIZE_MIN}
                aria-valuemax={SIZE_MAX}
                aria-valuenow={size}
                aria-valuetext={`${size} 乘 ${size} 像素`}
                aria-describedby={sizeHintId}
              />
              <p id={sizeHintId} className="text-sm text-muted">
                保存的图片使用这个像素尺寸。屏幕上的预览会按宽度缩小。
              </p>
            </div>

            <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0">
              <legend className="font-medium">纠错等级</legend>
              <p id={eccHintId} className="text-sm text-muted">
                等级越高，图案受损后越容易扫出来，但能放入的内容越少。
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {LEVELS.map((item) => (
                  <label key={item.id} className="choice">
                    <input
                      type="radio"
                      name="error-correction"
                      value={item.id}
                      checked={level === item.id}
                      onChange={() => setLevel(item.id)}
                      aria-describedby={eccHintId}
                    />
                    <span className="flex min-w-0 flex-col">
                      <span className="font-medium">{item.title}</span>
                      <span className="text-sm text-muted">{item.detail}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </form>
    </main>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (next: string) => void;
}) {
  const hexId = `${id}-hex`;
  const errorId = `${id}-error`;
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    setDraft((current) => (normalizeHex(current) === value ? current : value));
  }, [value]);

  const hexInvalid = draft.length >= 7 && normalizeHex(draft) === null;

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={id} className="font-medium">
        {label}
      </label>
      <div className="flex gap-2">
        <input
          id={id}
          className="swatch"
          type="color"
          value={value}
          onChange={(event) => onChange(event.target.value.toLowerCase())}
          aria-describedby={hexInvalid ? errorId : undefined}
        />
        <input
          id={hexId}
          className="hex font-mono tabular-nums"
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          maxLength={7}
          value={draft}
          aria-label={`${label}十六进制色值`}
          aria-invalid={hexInvalid}
          aria-describedby={hexInvalid ? errorId : undefined}
          onChange={(event) => {
            const next = event.target.value.trim();
            setDraft(next);
            const normalized = normalizeHex(next);
            if (normalized) onChange(normalized);
          }}
          onBlur={() => {
            const normalized = normalizeHex(draft);
            if (normalized) {
              setDraft(normalized);
              onChange(normalized);
            } else {
              setDraft(value);
            }
          }}
        />
      </div>
      {hexInvalid ? (
        <p id={errorId} role="alert" className="text-sm text-danger">
          请输入形如 #1a1a1a 的 6 位色值。
        </p>
      ) : null}
    </div>
  );
}

function preferShareSheet(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.share !== "function") return false;
  const ua = navigator.userAgent;
  const ios =
    /iPad|iPhone|iPod/.test(ua) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios || /Android/i.test(ua);
}

function isShareAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function fileFromDataUrl(dataUrl: string): File {
  const comma = dataUrl.indexOf(",");
  const header = comma >= 0 ? dataUrl.slice(0, comma) : "";
  const data = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const mime = /data:(.*?)(;|$)/.exec(header)?.[1] || "image/png";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return new File([bytes], "qrcode.png", { type: mime });
}

function triggerDownload(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildNotice(input: {
  text: string;
  error: string | null;
  phase: "idle" | "loading" | "done";
  contrast: number | null;
  stale: boolean;
}): Notice {
  if (!input.text.trim()) {
    return { text: "先写下网址或文字，再点生成。", tone: "muted" };
  }
  if (input.error) {
    return { text: input.error, tone: "danger" };
  }
  if (input.phase === "idle") {
    return { text: "写好后点「生成」，才会出现对应二维码。", tone: "muted" };
  }
  if (input.phase === "loading") {
    return { text: "正在生成…", tone: "muted" };
  }
  if (input.stale) {
    return { text: "内容或设置已改，再点一次生成才会更新。", tone: "warn" };
  }
  if (input.contrast !== null && input.contrast < MIN_CONTRAST) {
    return {
      text: `已生成。前景和背景太接近（对比度 ${input.contrast.toFixed(1)}:1），建议至少 ${MIN_CONTRAST}:1，否则可能扫不出来。`,
      tone: "warn",
    };
  }
  return { text: "已生成，可以保存。", tone: "muted" };
}

function explainError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  if (/too big|too long|maximum/i.test(raw)) {
    return "这段内容太长，当前纠错等级放不下。请缩短文字，或改用更低的纠错等级。";
  }
  return "无法生成二维码，请改一改内容后再试。";
}

function normalizeHex(input: string): string | null {
  const match = /^#([0-9a-fA-F]{6})$/.exec(input.trim());
  if (!match?.[1]) return null;
  return `#${match[1].toLowerCase()}`;
}

function contrastRatio(foreground: string, background: string): number | null {
  const a = rgb(foreground);
  const b = rgb(background);
  if (!a || !b) return null;
  const lighter = Math.max(luminance(a), luminance(b));
  const darker = Math.min(luminance(a), luminance(b));
  return (lighter + 0.05) / (darker + 0.05);
}

function rgb(hex: string): [number, number, number] | null {
  const normalized = normalizeHex(hex);
  if (!normalized) return null;
  const n = Number.parseInt(normalized.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const s = value / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}
