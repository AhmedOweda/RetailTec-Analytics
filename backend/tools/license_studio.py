"""
License Studio — vendor-side license generator with a GUI (NEVER ship this).
============================================================================
Run:  python license_studio.py          (pip install customtkinter cryptography)
Build as its own exe:
  pyinstaller license_studio.py --onefile --noconsole --name RetailTecLicenseStudio ^
      --collect-all customtkinter --icon ..\..\packaging\app.ico

What it does:
  1. Generate / load the vendor Ed25519 PRIVATE key (keep it offline & backed up
     — anyone holding it can mint licenses).
  2. Fill in customer, expiry, limits, licensed domains, optional device/Oracle
     host binding → signs and saves license.json (same canonical form
     services/license.py verifies). Every field is VALIDATED live: invalid
     entries get a red border + message and Generate stays disabled.
  3. Verify any existing license.json and show its contents/expiry/domains.
  4. "Apply public key to app" patches _PUBLIC_KEY_HEX in services/license.py
     (only needed after generating a NEW keypair).

Redesigned 28 Jul 2026 (owner request): modern dark UI (CustomTkinter),
per-domain switches, inline validation.
"""
from __future__ import annotations

import json
import re
import tkinter as tk
from datetime import date, datetime
from pathlib import Path
from tkinter import filedialog, messagebox

import customtkinter as ctk
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey, Ed25519PublicKey)

# ── Brand ────────────────────────────────────────────────────────────────────
ACCENT       = "#7c3aed"
ACCENT_HOVER = "#6d28d9"
BG           = "#0f0a1e"
CARD         = "#1a1230"
CARD_2       = "#221740"
BORDER       = "#37285e"
TEXT         = "#ede9fe"
TEXT_DIM     = "#a78bfa"
TEXT_MUTED   = "#8b85a0"
OK_GREEN     = "#34d399"
ERR_RED      = "#f87171"
WARN_AMBER   = "#fbbf24"

# Licensed product domains (must match services/license.py ALL_DOMAINS).
# All switches ON → the "domains" field is OMITTED from the payload, which
# means "all domains" — identical to every license issued before this feature,
# so old customers keep the full product.
DOMAINS = [
    ("home",       "Home dashboard"),
    ("ai",         "Ask AI assistant"),
    ("sales",      "Sales"),
    ("inventory",  "Inventory"),
    ("purchases",  "Purchasing"),
    ("accounting", "Accounting"),
    ("dimensions", "Dimensions"),
    ("reports",    "Reports & Email"),
]

_RE_DEVICE = re.compile(r"^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$")
_RE_HOST   = re.compile(r"^(?=.{1,253}$)([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)"
                        r"(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$")
_RE_IPV4   = re.compile(r"^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$")


def _find_license_py() -> Path | None:
    """Locate backend/services/license.py. Works from source (relative) AND
    from the packed one-file exe (where __file__ lives in a temp dir)."""
    candidates = [
        Path(__file__).parent.parent / "services" / "license.py",
        Path(r"C:\RetailTec\RetailTec-Analytics\backend\services\license.py"),
    ]
    import sys
    if getattr(sys, "frozen", False):
        # exe usually lives in <repo>\packaging\Output — walk up looking for backend/
        p = Path(sys.executable).resolve()
        for parent in p.parents:
            cand = parent / "backend" / "services" / "license.py"
            if cand.exists():
                candidates.insert(0, cand)
                break
    for c in candidates:
        if c.exists():
            return c
    return None


LICENSE_PY = _find_license_py()


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


# ── Field validators ─────────────────────────────────────────────────────────
# Each returns (ok, message). Empty message when ok.

def v_customer(v: str):
    v = v.strip()
    if not v:
        return False, "Customer name is required"
    if len(v) < 2:
        return False, "At least 2 characters"
    return True, ""


def v_expiry(v: str):
    v = v.strip()
    try:
        d = datetime.strptime(v, "%Y-%m-%d").date()
    except ValueError:
        return False, "Use YYYY-MM-DD (e.g. 2027-12-31)"
    if d < date.today():
        return False, "Expiry is in the past"
    if d > date(2100, 1, 1):
        return False, "Unreasonably far in the future"
    return True, ""


def v_int_blank(v: str):
    v = v.strip()
    if not v:
        return True, ""
    if not v.isdigit() or int(v) < 1:
        return False, "Whole number ≥ 1, or leave blank"
    return True, ""


def v_device(v: str):
    v = v.strip().upper()
    if not v:
        return True, ""
    if not _RE_DEVICE.match(v):
        return False, "Format: XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX (hex, from About page)"
    return True, ""


def v_host(v: str):
    v = v.strip()
    if not v:
        return True, ""
    m = _RE_IPV4.match(v)
    if m:
        if all(0 <= int(g) <= 255 for g in m.groups()):
            return True, ""
        return False, "IPv4 octets must be 0–255"
    if _RE_HOST.match(v):
        return True, ""
    return False, "Not a valid IP address or hostname"


class App(ctk.CTk):
    def __init__(self):
        super().__init__()
        ctk.set_appearance_mode("dark")
        self.title("RetailTec License Studio")
        self.geometry("800x780")
        self.minsize(760, 640)
        self.configure(fg_color=BG)
        try:
            ico = Path(__file__).parent.parent.parent / "packaging" / "app.ico"
            if ico.exists():
                self.iconbitmap(str(ico))
        except Exception:
            pass
        self.priv: Ed25519PrivateKey | None = None
        self.priv_path: Path | None = None
        self.fields: dict[str, ctk.CTkEntry] = {}
        self.errors: dict[str, ctk.CTkLabel] = {}
        self._build()
        self._revalidate()

    # ── UI scaffolding ──────────────────────────────────────────────────
    def _card(self, parent, title: str, subtitle: str = ""):
        card = ctk.CTkFrame(parent, fg_color=CARD, corner_radius=14,
                            border_width=1, border_color=BORDER)
        card.pack(fill="x", pady=(0, 12))
        head = ctk.CTkFrame(card, fg_color="transparent")
        head.pack(fill="x", padx=16, pady=(12, 0))
        ctk.CTkLabel(head, text=title, text_color=TEXT,
                     font=("Segoe UI", 15, "bold")).pack(side="left")
        if subtitle:
            ctk.CTkLabel(head, text=subtitle, text_color=TEXT_MUTED,
                         font=("Segoe UI", 11)).pack(side="right")
        body = ctk.CTkFrame(card, fg_color="transparent")
        body.pack(fill="both", expand=True, padx=16, pady=(8, 14))
        return card, body

    def _build(self):
        # Brand header
        head = ctk.CTkFrame(self, fg_color="#160b33", corner_radius=0, height=68)
        head.pack(fill="x")
        head.pack_propagate(False)
        ctk.CTkLabel(head, text="RetailTec", text_color="white",
                     font=("Segoe UI", 20, "bold")).pack(side="left", padx=(20, 0))
        ctk.CTkLabel(head, text="License Studio", text_color=TEXT_DIM,
                     font=("Segoe UI", 20)).pack(side="left", padx=(8, 0))
        badge = ctk.CTkFrame(head, fg_color="#2c1a52", corner_radius=20)
        badge.pack(side="right", padx=20)
        ctk.CTkLabel(badge, text="  vendor tool — never ship to customers  ",
                     text_color=TEXT_DIM, font=("Segoe UI", 11)).pack(padx=4, pady=3)

        outer = ctk.CTkScrollableFrame(self, fg_color=BG)
        outer.pack(fill="both", expand=True, padx=16, pady=12)

        # ── Vendor key card ─────────────────────────────────────────────
        _, kb = self._card(outer, "Vendor private key",
                           "keep it offline — it mints licenses")
        row = ctk.CTkFrame(kb, fg_color="transparent"); row.pack(fill="x")
        self.key_lbl = ctk.CTkLabel(row, text="no key loaded", text_color=WARN_AMBER,
                                    font=("Segoe UI", 12), anchor="w")
        self.key_lbl.pack(side="left", fill="x", expand=True)
        ctk.CTkButton(row, text="Load…", width=90, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      command=self.load_key).pack(side="left", padx=(8, 4))
        ctk.CTkButton(row, text="Generate new…", width=120, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      command=self.gen_key).pack(side="left")
        row2 = ctk.CTkFrame(kb, fg_color="transparent"); row2.pack(fill="x", pady=(8, 0))
        ctk.CTkLabel(row2, text="Public key", text_color=TEXT_MUTED,
                     font=("Segoe UI", 12), width=80, anchor="w").pack(side="left")
        self.pub_entry = ctk.CTkEntry(row2, font=("Consolas", 11), fg_color=CARD_2,
                                      border_color=BORDER, text_color=TEXT)
        self.pub_entry.pack(side="left", fill="x", expand=True, padx=8)
        self.pub_entry.configure(state="disabled")
        ctk.CTkButton(row2, text="Apply to app", width=110, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      command=self.patch_app).pack(side="left")

        # ── New license card ────────────────────────────────────────────
        _, lb = self._card(outer, "New license", "all fields validated as you type")
        grid = ctk.CTkFrame(lb, fg_color="transparent"); grid.pack(fill="x")
        grid.grid_columnconfigure(1, weight=1)
        specs = [
            ("customer",         "Customer name *",     "", v_customer,  "e.g. Aseela Trading"),
            ("expiry",           "Expiry date *",       f"{date.today().year + 1}-12-31",
                                                            v_expiry,    "YYYY-MM-DD"),
            ("max_subsidiaries", "Max subsidiaries",    "", v_int_blank, "blank = unlimited"),
            ("max_users",        "Max users / install", "", v_int_blank, "blank = unlimited"),
            ("device_code",      "Device code",         "", v_device,    "blank = any device (About page shows it)"),
            ("oracle_host",      "Oracle host binding", "", v_host,      "blank = any server"),
        ]
        self.validators = {k: fn for k, _, _, fn, _ in specs}
        r = 0
        for key, label, default, _fn, hint in specs:
            ctk.CTkLabel(grid, text=label, text_color=TEXT, font=("Segoe UI", 12.5),
                         width=150, anchor="w").grid(row=r, column=0, sticky="w", pady=(7, 0))
            e = ctk.CTkEntry(grid, font=("Segoe UI", 12.5), fg_color=CARD_2,
                             border_color=BORDER, text_color=TEXT,
                             placeholder_text=hint, height=34)
            e.grid(row=r, column=1, sticky="ew", pady=(7, 0), padx=(10, 0))
            if default:
                e.insert(0, default)
            e.bind("<KeyRelease>", lambda _ev, k=key: self._revalidate(k))
            e.bind("<FocusOut>",  lambda _ev, k=key: self._revalidate(k))
            self.fields[key] = e
            err = ctk.CTkLabel(grid, text="", text_color=ERR_RED,
                               font=("Segoe UI", 10.5), anchor="w")
            err.grid(row=r + 1, column=1, sticky="w", padx=(12, 0))
            err.grid_remove()
            self.errors[key] = err
            r += 2

        # Domains
        dhead = ctk.CTkFrame(lb, fg_color="transparent"); dhead.pack(fill="x", pady=(12, 2))
        ctk.CTkLabel(dhead, text="Licensed domains", text_color=TEXT,
                     font=("Segoe UI", 12.5, "bold")).pack(side="left")
        self.dom_summary = ctk.CTkLabel(dhead, text="", text_color=TEXT_MUTED,
                                        font=("Segoe UI", 11))
        self.dom_summary.pack(side="left", padx=10)
        ctk.CTkButton(dhead, text="All", width=44, height=24, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      font=("Segoe UI", 11),
                      command=lambda: self._set_domains(True)).pack(side="right", padx=(4, 0))
        ctk.CTkButton(dhead, text="None", width=52, height=24, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      font=("Segoe UI", 11),
                      command=lambda: self._set_domains(False)).pack(side="right")
        domf = ctk.CTkFrame(lb, fg_color=CARD_2, corner_radius=10)
        domf.pack(fill="x")
        for c in range(2):
            domf.grid_columnconfigure(c, weight=1)
        self.domain_vars: dict[str, tk.BooleanVar] = {}
        for i, (key, label) in enumerate(DOMAINS):
            var = tk.BooleanVar(value=True)
            self.domain_vars[key] = var
            ctk.CTkSwitch(domf, text=label, variable=var, progress_color=ACCENT,
                          font=("Segoe UI", 12), text_color=TEXT,
                          command=self._revalidate).grid(
                row=i // 2, column=i % 2, sticky="w", padx=14, pady=6)
        self.dom_err = ctk.CTkLabel(lb, text="Select at least one domain",
                                    text_color=ERR_RED, font=("Segoe UI", 10.5))
        self.dom_err.pack(anchor="w", padx=4)
        self.dom_err.pack_forget()

        foot = ctk.CTkFrame(lb, fg_color="transparent"); foot.pack(fill="x", pady=(12, 0))
        # Explicit width — auto-sizing clipped the label on scaled displays
        # (owner report 28 Jul: "rate signed license.js").
        self.gen_btn = ctk.CTkButton(foot, text="Generate signed license.json…",
                                     fg_color=ACCENT, hover_color=ACCENT_HOVER,
                                     font=("Segoe UI", 13, "bold"), height=40,
                                     width=300, command=self.generate)
        self.gen_btn.pack(side="left")
        self.gen_hint = ctk.CTkLabel(foot, text="", text_color=TEXT_MUTED,
                                     font=("Segoe UI", 11))
        self.gen_hint.pack(side="left", padx=12)

        # ── Verify card ─────────────────────────────────────────────────
        _, vb = self._card(outer, "Verify a license file")
        vrow = ctk.CTkFrame(vb, fg_color="transparent"); vrow.pack(fill="x")
        ctk.CTkButton(vrow, text="Open license.json to verify…", width=230,
                      fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      command=self.verify).pack(side="left")
        # Activity lives in a popup (owner request 28 Jul) — main window stays
        # compact; the popup opens itself whenever an action logs something.
        ctk.CTkButton(vrow, text="Activity log…", width=120, fg_color=CARD_2,
                      hover_color=BORDER, border_width=1, border_color=BORDER,
                      command=self._show_log).pack(side="left", padx=(8, 0))
        self._log_lines: list[str] = []
        self._log_win: ctk.CTkToplevel | None = None
        self.out: ctk.CTkTextbox | None = None

    # ── Validation plumbing ─────────────────────────────────────────────
    def _field_ok(self, key: str) -> bool:
        ok, msg = self.validators[key](self.fields[key].get())
        if ok:
            self.fields[key].configure(border_color=BORDER)
            self.errors[key].grid_remove()
        else:
            self.fields[key].configure(border_color=ERR_RED)
            self.errors[key].configure(text=msg)
            self.errors[key].grid()
        return ok

    def _revalidate(self, only: str | None = None):
        """Validate one field (live) then refresh the overall Generate state."""
        if only:
            self._field_ok(only)
        all_ok = all(self.validators[k](self.fields[k].get())[0] for k in self.fields)
        picked = [k for k, _ in DOMAINS if self.domain_vars[k].get()]
        if picked:
            self.dom_err.pack_forget()
        else:
            self.dom_err.pack(anchor="w", padx=4)
        self.dom_summary.configure(
            text="full product" if len(picked) == len(DOMAINS)
            else f"{len(picked)} of {len(DOMAINS)} selected")
        ready = all_ok and bool(picked) and self.priv is not None
        self.gen_btn.configure(state="normal" if ready else "disabled")
        self.gen_hint.configure(
            text="" if ready else
            ("load or generate the private key first" if self.priv is None
             else "fix the highlighted fields"))

    def _set_domains(self, value: bool):
        for var in self.domain_vars.values():
            var.set(value)
        self._revalidate()

    # ── Logging (popup window) ──────────────────────────────────────────
    def _show_log(self):
        if self._log_win is not None and self._log_win.winfo_exists():
            self._log_win.lift()
            self._log_win.focus_force()
            return
        w = ctk.CTkToplevel(self)
        w.title("Activity — RetailTec License Studio")
        w.geometry("720x420")
        w.configure(fg_color=BG)
        self._log_win = w
        self.out = ctk.CTkTextbox(w, font=("Consolas", 11), fg_color=CARD_2,
                                  text_color=TEXT, border_width=0, wrap="word")
        self.out.pack(fill="both", expand=True, padx=12, pady=12)
        self.out.insert("end", "\n".join(self._log_lines) + ("\n" if self._log_lines else ""))
        self.out.see("end")
        self.out.configure(state="disabled")

        def _closed():
            self._log_win = None
            self.out = None
            w.destroy()
        w.protocol("WM_DELETE_WINDOW", _closed)

    def log(self, msg: str):
        """Append to the activity buffer and surface the popup."""
        self._log_lines.append(msg)
        if self._log_win is None or not self._log_win.winfo_exists():
            self._show_log()      # opens and renders the whole buffer
            return
        self.out.configure(state="normal")
        self.out.insert("end", msg + "\n")
        self.out.see("end")
        self.out.configure(state="disabled")
        self._log_win.lift()

    def _show_pub(self):
        pub = self.priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
        self.pub_entry.configure(state="normal")
        self.pub_entry.delete(0, "end")
        self.pub_entry.insert(0, pub)
        self.pub_entry.configure(state="disabled")
        return pub

    # ── Key handling ────────────────────────────────────────────────────
    def load_key(self):
        p = filedialog.askopenfilename(title="Open Ed25519 private key (PEM)",
                                       filetypes=[("PEM key", "*.pem"), ("All files", "*.*")])
        if not p:
            return
        try:
            priv = serialization.load_pem_private_key(Path(p).read_bytes(), password=None)
            assert isinstance(priv, Ed25519PrivateKey)
        except Exception as e:
            messagebox.showerror("Load failed", f"Not a valid Ed25519 PEM key:\n{e}")
            return
        self.priv = priv
        self.priv_path = Path(p)
        self.key_lbl.configure(text=p, text_color=OK_GREEN)
        self.log(f"Loaded key: {p}")
        self.log(f"Public key: {self._show_pub()}")
        self._revalidate()

    def gen_key(self):
        p = filedialog.asksaveasfilename(
            title="Save NEW private key as… (keep it offline and backed up)",
            defaultextension=".pem", initialfile="retailtec_license_private_key.pem",
            filetypes=[("PEM key", "*.pem")])
        if not p:
            return
        self.priv = Ed25519PrivateKey.generate()
        pem = self.priv.private_bytes(
            serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption())
        Path(p).write_bytes(pem)
        self.priv_path = Path(p)
        self.key_lbl.configure(text=p, text_color=OK_GREEN)
        pub = self._show_pub()
        self.log(f"NEW keypair generated. Private key: {p}")
        self.log(f"Public key: {pub}")
        self.log("IMPORTANT: back up the private key, then click 'Apply to app' so the")
        self.log("application accepts licenses signed with this new key.")
        self._revalidate()

    def patch_app(self):
        global LICENSE_PY
        pub = self.pub_entry.get().strip()
        if not pub:
            messagebox.showwarning("No key", "Load or generate a key first.")
            return
        if LICENSE_PY is None or not LICENSE_PY.exists():
            p = filedialog.askopenfilename(
                title="Locate the app's backend/services/license.py",
                filetypes=[("license.py", "license.py"), ("Python", "*.py")])
            if not p:
                return
            LICENSE_PY = Path(p)
        src = LICENSE_PY.read_text(encoding="utf-8")
        new = re.sub(r'_PUBLIC_KEY_HEX = "[0-9a-f]+"',
                     f'_PUBLIC_KEY_HEX = "{pub}"', src)
        if new == src:
            messagebox.showinfo("No change", "Public key already applied (or pattern not found).")
            return
        LICENSE_PY.write_text(new, encoding="utf-8")
        self.log(f"Patched _PUBLIC_KEY_HEX in {LICENSE_PY}")
        self.log("Rebuild the app exe so customers get the new key.")

    # ── Generate ────────────────────────────────────────────────────────
    def generate(self):
        # Belt and braces: the button is disabled until valid, but re-check
        # everything here anyway (keyboard shortcuts, race with live check).
        bad = [k for k in self.fields if not self._field_ok(k)]
        picked = [k for k, _ in DOMAINS if self.domain_vars[k].get()]
        if self.priv is None or bad or not picked:
            self._revalidate()
            return
        customer = self.fields["customer"].get().strip()
        expiry   = self.fields["expiry"].get().strip()
        payload = {"customer": customer, "expiry": expiry,
                   "issued": date.today().isoformat()}
        for key in ("max_subsidiaries", "max_users"):
            v = self.fields[key].get().strip()
            if v:
                payload[key] = int(v)
        device = self.fields["device_code"].get().strip().upper()
        if device:
            payload["device_code"] = device
        host = self.fields["oracle_host"].get().strip()
        if host:
            payload["oracle_host"] = host
        # Licensed domains: all ON → omit the field entirely (= all domains,
        # byte-identical payload shape to pre-domain licenses).
        if len(picked) < len(DOMAINS):
            payload["domains"] = picked

        out = filedialog.asksaveasfilename(
            title="Save signed license as…", defaultextension=".json",
            initialfile="license.json", filetypes=[("JSON", "*.json")])
        if not out:
            return
        signature = self.priv.sign(canonical(payload)).hex()
        Path(out).write_text(json.dumps({"payload": payload, "signature": signature}, indent=2))
        self.log(f"License written: {out}")
        self.log(f"  customer={customer}  expiry={expiry}  "
                 + "  ".join(f"{k}={payload[k]}" for k in
                             ("max_subsidiaries", "max_users", "device_code", "oracle_host")
                             if k in payload))
        self.log("  domains=" + (",".join(payload["domains"])
                                 if "domains" in payload else "ALL (full product)"))
        self.log("Send this file to the customer — it goes to "
                 r"C:\ProgramData\RetailTec Analytics\license.json "
                 "(or next to the app's settings; the About page shows the exact path).")

    # ── Verify ──────────────────────────────────────────────────────────
    def verify(self):
        p = filedialog.askopenfilename(title="Open license.json",
                                       filetypes=[("JSON", "*.json")])
        if not p:
            return
        try:
            doc = json.loads(Path(p).read_text())
            payload, sig = doc.get("payload") or {}, doc.get("signature") or ""
        except Exception as e:
            messagebox.showerror("Invalid file", str(e))
            return
        pub_hex = self.pub_entry.get().strip() or self._embedded_pub()
        if not pub_hex:
            messagebox.showwarning("No key", "Load a key (or keep license.py nearby) first.")
            return
        try:
            pub = Ed25519PublicKey.from_public_bytes(bytes.fromhex(pub_hex))
            pub.verify(bytes.fromhex(sig), canonical(payload))
            ok = True
        except Exception:
            ok = False
        exp = payload.get("expiry", "?")
        days = None
        try:
            days = (datetime.strptime(exp, "%Y-%m-%d").date() - date.today()).days
        except Exception:
            pass
        self.log(f"Verify {p}:")
        self.log(f"  signature: {'VALID' if ok else 'INVALID (wrong key or tampered)'}")
        self.log(f"  payload:   {json.dumps(payload)}")
        self.log("  domains:   " + (",".join(payload.get("domains"))
                                    if payload.get("domains") else "ALL (unrestricted)"))
        if days is not None:
            self.log(f"  expiry:    {exp} ({'EXPIRED ' + str(-days) + 'd ago' if days < 0 else str(days) + ' days left'})")

    def _embedded_pub(self) -> str:
        try:
            if LICENSE_PY is None:
                return ""
            m = re.search(r'_PUBLIC_KEY_HEX = "([0-9a-f]+)"',
                          LICENSE_PY.read_text(encoding="utf-8"))
            return m.group(1) if m else ""
        except Exception:
            return ""


if __name__ == "__main__":
    App().mainloop()
