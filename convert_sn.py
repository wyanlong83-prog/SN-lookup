#!/usr/bin/env python3
"""把 SN.xlsx 转换成网页小程序使用的 data.json。

用法:
    python3 convert_sn.py                # 默认读取上一级目录的 SN.xlsx
    python3 convert_sn.py 其他文件.xlsx  # 指定文件
"""

import datetime
import json
import sys
from pathlib import Path

import openpyxl

BASE_DIR = Path(__file__).resolve().parent


def clean(value):
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if isinstance(value, str):
        return value.strip()
    return value


def main():
    if len(sys.argv) > 1:
        xlsx_path = Path(sys.argv[1]).expanduser()
    else:
        xlsx_path = BASE_DIR.parent / "SN.xlsx"

    if not xlsx_path.exists():
        sys.exit(f"找不到文件: {xlsx_path}")

    wb = openpyxl.load_workbook(xlsx_path, data_only=True, read_only=True)
    ws = wb.worksheets[0]
    rows = list(ws.iter_rows(values_only=True))
    wb.close()

    header_index = None
    sn_col = None
    for i, row in enumerate(rows):
        for j, cell in enumerate(row):
            if str(cell or "").strip().upper() == "SN":
                header_index, sn_col = i, j
                break
        if header_index is not None:
            break

    if header_index is None:
        sys.exit("未找到表头中的 SN 列，请检查 Excel 第一行。")

    headers = [
        str(c or "").strip() or f"列{i + 1}"
        for i, c in enumerate(rows[header_index])
    ]
    headers[sn_col] = "SN"

    # 同一个 SN 只保留最后一条，避免查询出现歧义
    unique = {}
    for row in rows[header_index + 1:]:
        if not row or sn_col >= len(row):
            continue
        sn = clean(row[sn_col])
        if sn == "":
            continue
        sn = str(sn)
        if sn in unique:
            print(f"警告: SN 重复 {sn}（已保留最后一条）")
        record = {"SN": sn}
        for i, header in enumerate(headers):
            if i == sn_col or i >= len(row):
                continue
            record[header] = clean(row[i])
        unique[sn] = record
    records = list(unique.values())

    payload = {
        "generatedAt": datetime.datetime.now().astimezone().isoformat(timespec="seconds"),
        "source": xlsx_path.name,
        "columns": headers,
        "records": records,
    }

    out_path = BASE_DIR / "data.json"
    out_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    print(f"已生成 {out_path}（{len(records)} 条 SN，来源：{xlsx_path.name}）")


if __name__ == "__main__":
    main()
