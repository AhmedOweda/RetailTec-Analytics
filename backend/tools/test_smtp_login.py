# SMTP connectivity/login check — does NOT send any email.
import sys, smtplib
sys.path.insert(0, r"C:\RetailTec\RetailTec-Analytics\backend")
from services.config import load_settings

s = load_settings()
e = s["email"] if isinstance(s, dict) else s.email
host, port = e["host"], int(e["port"])
user, pw, tls = e["username"], e["password"], e.get("use_tls", True)
print(f"connecting {host}:{port} tls={tls} user={user}")
try:
    smtp = smtplib.SMTP(host, port, timeout=20)
    smtp.ehlo()
    if tls:
        smtp.starttls(); smtp.ehlo()
    smtp.login(user, pw)
    print("LOGIN OK - email sending should work")
    smtp.quit()
except Exception as ex:
    print(f"FAILED: {type(ex).__name__}: {ex}")
