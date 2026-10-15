# common-passwords.json — nguồn và giấy phép

**Nguồn:** SecLists, `Passwords/Common-Credentials/xato-net-10-million-passwords-1000000.txt`
(https://github.com/danielmiessler/SecLists), lấy ngày 2026-10-15.

**Biến đổi:** chỉ giữ mục có 12–256 ký tự ASCII in được (mục ngắn hơn 12 đã bị luật độ dài tối thiểu
chặn, ADR-049), chuyển chữ thường, bỏ trùng, sắp xếp. Kết quả: 46 146 mục.

Tạo lại:

```sh
node -e "const fs=require('fs');const s=new Set();for(const l of fs.readFileSync(process.argv[1],'latin1').split(/\r?\n/))if(l.length>=12&&l.length<=256&&/^[\x20-\x7e]+$/.test(l))s.add(l.toLowerCase());fs.writeFileSync(process.argv[2],JSON.stringify([...s].sort(),null,2)+'\n')" xato-net-10-million-passwords-1000000.txt common-passwords.json
```

**Giấy phép SecLists (MIT):**

MIT License

Copyright (c) 2018 Daniel Miessler

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
