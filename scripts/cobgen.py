"""固定形式 COBOL を正しい桁で書くための小さな部品（サンプル生成用）。

1〜6 桁目の連番、7 桁目の標識、8〜72 桁目のコード。72 桁を超える文字列リテラルは、
72 桁ちょうどで折って継続行（7 桁目 `-`）にする。折り目の直後が短すぎると、閉じ引用符が
73 桁以降（読まれない領域）に落ちるので、VALUE の前に空白を足して位置をずらす。
"""


class Prog:
    FIRST_WIDTH = 65  # 8〜72 桁

    def __init__(self):
        self.lines = []

    def A(self, text):  # A 領域（8 桁目から）
        self.lines.append(text)

    def B(self, text):  # B 領域（12 桁目から）
        self.lines.append("    " + text)

    def lit(self, prefix, text, suffix="."):
        room = self.FIRST_WIDTH - 4 - 1  # 継続行（12 桁目の引用符のあと）に入る文字数
        for pad in range(0, 8):
            p = prefix.replace(" VALUE ", " " * (pad + 1) + "VALUE ") if pad else prefix
            full = p + '"' + text
            if len(full) + 1 + len(suffix) <= self.FIRST_WIDTH:
                self.lines.append(full + '"' + suffix)
                return
            rest = full[self.FIRST_WIDTH :]
            if len(rest) >= 3:
                self.lines.append(full[: self.FIRST_WIDTH])
                while True:
                    if len(rest) + 1 + len(suffix) <= room:
                        self.lines.append(("CONT", "    " + '"' + rest + '"' + suffix))
                        return
                    self.lines.append(("CONT", "    " + '"' + rest[:room]))
                    rest = rest[room:]
                    if 0 < len(rest) < 3:
                        raise SystemExit("継続行の折り目が短すぎます: " + text)
        raise SystemExit("折れませんでした: " + text)

    def head(self, program_id, region, author="COBOLFORM"):
        self.A("IDENTIFICATION DIVISION.")
        self.A(f"PROGRAM-ID. {program_id}.")
        self.A(f"AUTHOR. {author}.")
        self.A("ENVIRONMENT DIVISION.")
        self.A("CONFIGURATION SECTION.")
        self.A(f"OBJECT-COMPUTER. AWS-{region}.")
        self.A("DATA DIVISION.")
        self.A("WORKING-STORAGE SECTION.")

    def res(self, name, rtype, rows):
        """01 グループ 1 つ。rows は (項目名, 値)。値が int なら PIC 9、str なら PIC X。"""
        self.A(f"01  {name}.")
        self.lit("    05  RESOURCE-TYPE    PIC X(%d) VALUE " % len(rtype), rtype)
        for n, val in rows:
            if isinstance(val, int):
                self.B(f"05  {n:<20} PIC 9({len(str(val))}) VALUE {val}.")
            else:
                self.lit(f"    05  {n:<20} PIC X({max(len(val), 1)}) VALUE ", val)

    def table(self, group, children):
        """OCCURS の表。children は (項目名, PIC)。"""
        self.B(f"05  {group[0]} OCCURS {group[1]} TIMES.")
        for n, pic in children:
            self.B(f"    10  {n:<18} PIC {pic}.")

    def tail(self, moves=(), call="DEPLOY"):
        self.A("PROCEDURE DIVISION.")
        self.A("MAIN-PARA.")
        for val, target in moves:
            self.B(f"MOVE {val} TO {target}." if str(val).isdigit() else f'MOVE "{val}" TO {target}.')
        self.B(f'CALL "{call}".')
        self.B("STOP RUN.")

    def save(self, path):
        out, n = [], 100
        for item in self.lines:
            out.append(f"{n:06d}-" + item[1] if isinstance(item, tuple) else f"{n:06d} " + item)
            n += 100
        too_long = [line for line in out if len(line) > 72]
        if too_long:
            raise SystemExit("72 桁を超える行があります: " + too_long[0])
        with open(path, "w") as f:
            f.write("\n".join(out) + "\n")
