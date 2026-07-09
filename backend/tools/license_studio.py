"""
License Studio — vendor-side license generator with a GUI (NEVER ship this).
============================================================================
Run:  python license_studio.py
Build as its own exe:
  pyinstaller license_studio.py --onefile --noconsole --name RetailTecLicenseStudio

What it does:
  1. Generate / load the vendor Ed25519 PRIVATE key (keep it offline & backed up
     — anyone holding it can mint licenses).
  2. Fill in customer, expiry, limits, optional Oracle host binding →
     signs and saves license.json (same canonical form services/license.py verifies).
  3. Verify any existing license.json and show its contents/expiry.
  4. "Apply public key to app" patches _PUBLIC_KEY_HEX in services/license.py
     (only needed after generating a NEW keypair).
"""
from __future__ import annotations

import json
import re
import tkinter as tk
from datetime import date, datetime
from pathlib import Path
from tkinter import filedialog, messagebox, ttk

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import (
    Ed25519PrivateKey, Ed25519PublicKey)

ACCENT  = "#7c3aed"
LICENSE_PY = Path(__file__).parent.parent / "services" / "license.py"


def canonical(payload: dict) -> bytes:
    return json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()


class App(tk.Tk):
    def __init__(self):
        super().__init__()
        self.title("RetailTec License Studio")
        self.geometry("700x640")
        self.resizable(False, False)
        self.configure(bg="#f8fafc")
        try:
            ico = Path(__file__).parent.parent.parent / "packaging" / "app.ico"
            if ico.exists():
                self.iconbitmap(str(ico))
        except Exception:
            pass
        self.priv: Ed25519PrivateKey | None = None
        self.priv_path: Path | None = None
        self._build()

    # ── UI ──────────────────────────────────────────────────────────────
    def _build(self):
        s = ttk.Style(self)
        try:
            s.theme_use("vista")
        except Exception:
            pass
        s.configure("TLabelframe", background="#f8fafc")
        s.configure("TLabelframe.Label", font=("Segoe UI", 10, "bold"),
                    foreground=ACCENT, background="#f8fafc")
        s.configure("TFrame", background="#f8fafc")
        s.configure("TLabel", background="#f8fafc", font=("Segoe UI", 9))
        s.configure("TButton", font=("Segoe UI", 9))
        s.configure("Go.TButton", font=("Segoe UI", 10, "bold"))

        # Brand header
        head = tk.Frame(self, bg="#160b33", height=64)
        head.pack(fill="x")
        head.pack_propagate(False)
        tk.Label(head, text="RetailTec  License Studio", bg="#160b33", fg="white",
                 font=("Segoe UI", 15, "bold")).pack(side="left", padx=18, pady=14)
        tk.Label(head, text="vendor tool — never ship to customers",
                 bg="#160b33", fg="#a78bfa", font=("Segoe UI", 9)).pack(
                 side="right", padx=18)

        body = ttk.Frame(self); body.pack(fill="both", expand=True, padx=14, pady=10)

        kf = ttk.Labelframe(body, text=" Vendor private key ", padding=10)
        kf.pack(fill="x", pady=(0, 8))
        row = ttk.Frame(kf); row.pack(fill="x")
        self.key_var = tk.StringVar(value="(no key loaded)")
        ttk.Label(row, textvariable=self.key_var, width=58,
                  foreground="#475569").pack(side="left")
        ttk.Button(row, text="Load…", command=self.load_key).pack(side="left", padx=4)
        ttk.Button(row, text="Generate new…", command=self.gen_key).pack(side="left")
        row2 = ttk.Frame(kf); row2.pack(fill="x", pady=(6, 0))
        self.pub_var = tk.StringVar(value="")
        ttk.Label(row2, text="Public key:").pack(side="left")
        ttk.Entry(row2, textvariable=self.pub_var, width=54,
                  state="readonly", font=("Consolas", 9)).pack(side="left", padx=6)
        ttk.Button(row2, text="Apply to app", command=self.patch_app).pack(side="left")

        lf = ttk.Labelframe(body, text=" New license ", padding=10)
        lf.pack(fill="x", pady=(0, 8))
        form = ttk.Frame(lf); form.pack(fill="x")
        self.f = {}
        fields = [
            ("Customer name",              "customer",    ""),
            ("Expiry (YYYY-MM-DD)",        "expiry",      f"{date.today().year + 1}-12-31"),
            ("Max subsidiaries (blank = none)", "max_subsidiaries", ""),
            ("Device code (blank = any device)", "device_code", ""),
            ("Oracle host binding (blank = any)", "oracle_host", ""),
        ]
        for i, (label, key, default) in enumerate(fields):
            ttk.Label(form, text=label, width=30, anchor="w").grid(row=i, column=0, sticky="w", pady=3)
            var = tk.StringVar(value=default)
            self.f[key] = var
            ttk.Entry(form, textvariable=var, width=42).grid(row=i, column=1, sticky="w")

        ttk.Button(lf, text="Generate signed license.json…", style="Go.TButton",
                   command=self.generate).pack(anchor="w", pady=(8, 0))

        vf = ttk.Labelframe(body, text=" Verify a license file ", padding=10)
        vf.pack(fill="x", pady=(0, 8))
        ttk.Button(vf, text="Open license.json to verify…",
                   command=self.verify).pack(anchor="w")

        of = ttk.Labelframe(body, text=" Activity ", padding=6)
        of.pack(fill="both", expand=True)
        self.out = tk.Text(of, height=9, font=("Consolas", 9), state="disabled",
                           bg="#ffffff", relief="flat", fg="#334155")
        self.out.pack(fill="both", expand=True)

    def log(self, msg: str):
        self.out.configure(state="normal")
        self.out.insert("end", msg + "\n")
        self.out.see("end")
        self.out.configure(state="disabled")

    def _show_pub(self):
        pub = self.priv.public_key().public_bytes(
            serialization.Encoding.Raw, serialization.PublicFormat.Raw).hex()
        self.pub_var.set(pub)
        return pub

    # ── Key handling ────────────────────────────────────────────────────
    def load_key(self):
        p = filedialog.askopenfilename(title="Open Ed25519 private key (PEM)",
                                       filetypes=[("PEM key", "*.pem"), ("All files", "*.*")])
        if not p:
            return
        try:
            self.priv = serialization.load_pem_private_key(Path(p).read_bytes(), password=None)
            assert isinstance(self.priv, Ed25519PrivateKey)
        except Exception as e:
            messagebox.showerror("Load failed", f"Not a valid Ed25519 PEM key:\n{e}")
            return
        self.priv_path = Path(p)
        self.key_var.set(p)
        self.log(f"Loaded key: {p}")
        self.log(f"Public key: {self._show_pub()}")

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
        self.key_var.set(p)
        pub = self._show_pub()
        self.log(f"NEW keypair generated. Private key: {p}")
        self.log(f"Public key: {pub}")
        self.log("IMPORTANT: back up the private key, then click 'Apply to app' so the")
        self.log("application accepts licenses signed with this new key.")

    def patch_app(self):
        pub = self.pub_var.get().strip()
        if not pub:
            messagebox.showwarning("No key", "Load or generate a key first.")
            return
        if not LICENSE_PY.exists():
            messagebox.showerror("Not found", f"Cannot find {LICENSE_PY}")
            return
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
        if self.priv is None:
            messagebox.showwarning("No key", "Load or generate the private key first.")
            return
        customer = self.f["customer"].get().strip()
        expiry   = self.f["expiry"].get().strip()
        if not customer:
            messagebox.showwarning("Missing", "Customer name is required.")
            return
        try:
            datetime.strptime(expiry, "%Y-%m-%d")
        except ValueError:
            messagebox.showwarning("Bad date", "Expiry must be YYYY-MM-DD.")
            return
        payload = {"customer": customer, "expiry": expiry,
                   "issued": date.today().isoformat()}
        v = self.f["max_subsidiaries"].get().strip()
        if v:
            try:
                payload["max_subsidiaries"] = int(v)
            except ValueError:
                messagebox.showwarning("Bad number", "Max subsidiaries must be a whole number.")
                return
        device = self.f["device_code"].get().strip().upper()
        if device:
            payload["device_code"] = device
        host = self.f["oracle_host"].get().strip()
        if host:
            payload["oracle_host"] = host

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
                             ("max_subsidiaries", "device_code", "oracle_host") if k in payload))
        self.log("Send this file to the customer — it goes next to the app's settings"
                 " (backend/ in dev, _internal in the packaged install).")

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
        pub_hex = self.pub_var.get().strip() or self._embedded_pub()
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
        if days is not None:
            self.log(f"  expiry:    {exp} ({'EXPIRED ' + str(-days) + 'd ago' if days < 0 else str(days) + ' days left'})")

    def _embedded_pub(self) -> str:
        try:
            m = re.search(r'_PUBLIC_KEY_HEX = "([0-9a-f]+)"',
                          LICENSE_PY.read_text(encoding="utf-8"))
            return m.group(1) if m else ""
        except Exception:
            return ""


if __name__ == "__main__":
    App().mainloop()
