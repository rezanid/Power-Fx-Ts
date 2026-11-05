// Reference harness: evaluates expressions with the pinned upstream Power Fx (C#) and emits JSON
// vectors that the TypeScript tests replay. Nothing here is derived from the TypeScript code.
//
//   dotnet run --project tools/reference-harness -- eval <float|decimal> <file>   one expression per line
//   dotnet run --project tools/reference-harness -- generate <out.json>           differential fixture
//   dotnet run --project tools/reference-harness -- registry <out.tsv>            pinned Core registry inventory
//   dotnet run --project tools/reference-harness -- count-cast-probe <float|decimal> <file>   Float counts and runtime Int32 casts
//
// "float" = RecalcEngine(numberIsFloat: true) (profile v1-float); "decimal" = default PowerFxV1
// (profile v1-decimal). Both use Features.PowerFxV1 and en-US.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.PowerFx;
using Microsoft.PowerFx.Types;

static class P
{
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    const string MAX = "79228162514264337593543950335";

    record Entry(string Group, string Mode, string Expr, string Kind, string Value, string Direct, bool? DirectAgrees);

    static RecalcEngine Engine(string mode) =>
        new RecalcEngine(new PowerFxConfig(Features.PowerFxV1), numberIsFloat: mode == "float");

    static (string kind, string value) Run(RecalcEngine e, string mode, string expr)
    {
        try
        {
            var r = e.Eval(expr, null, new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = mode == "float" });
            return r switch
            {
                DecimalValue d => ("Decimal", d.Value.ToString(Inv)),
                NumberValue n => ("Number", n.Value.ToString("R", Inv)),
                StringValue s => ("Text", s.Value),
                BooleanValue b => ("Boolean", b.Value ? "true" : "false"),
                BlankValue => ("Blank", ""),
                ErrorValue ev => ("Error", ev.Errors[0].Kind.ToString()),
                _ => ("Other", r.ToExpression()),
            };
        }
        catch (Exception x)
        {
            var m = x.InnerException?.Message ?? x.Message;
            return ("Invalid", m.Split('\n')[0]);
        }
    }

    // System.Decimal evaluated directly, independent of Power Fx.
    static string Direct(string op, string a, string b)
    {
        try
        {
            decimal x = decimal.Parse(a, NumberStyles.Float, Inv), y = decimal.Parse(b, NumberStyles.Float, Inv);
            decimal r = op switch { "+" => x + y, "-" => x - y, "*" => x * y, "/" => x / y, _ => throw new InvalidOperationException() };
            return r.ToString(Inv);
        }
        catch (OverflowException) { return "Numeric"; }
        catch (DivideByZeroException) { return "Div0"; }
    }

    // Canonical, implementation-neutral rendering used by `probe` (tests parse the same grammar).
    static string SerType(FormulaType t) => t switch
    {
        DecimalType => "Decimal",
        NumberType => "Number",
        StringType => "Text",
        BooleanType => "Boolean",
        BlankType => "Blank",
        RecordType r => "{" + string.Join(",", r.GetFieldTypes().OrderBy(f => f.Name, StringComparer.Ordinal).Select(f => f.Name + ":" + SerType(f.Type))) + "}",
        TableType tt => "Table" + SerType(tt.ToRecord()),
        _ => t.ToString(),
    };

    static string SerValue(FormulaValue v) => v switch
    {
        BlankValue => "Blank",
        DecimalValue d => "Decimal(" + d.Value.ToString(Inv) + ")",
        NumberValue n => "Number(" + n.Value.ToString("R", Inv) + ")",
        StringValue s => JsonSerializer.Serialize(s.Value),
        BooleanValue b => b.Value ? "true" : "false",
        ErrorValue e => "Error(" + string.Join("+", e.Errors.Select(x => x.Kind.ToString())) + ")",
        RecordValue r => "{" + string.Join(",", r.Fields.Select(f => f.Name + ":" + SerValue(f.Value))) + "}",
        TableValue t => "Table[" + string.Join(",", t.Rows.Select(x => x.IsValue ? SerValue(x.Value) : x.IsBlank ? "Blank" : SerValue(x.ToFormulaValue()))) + "]",
        _ => v.ToExpression(),
    };

    static string Lit(string s) => s.StartsWith("-") ? "(" + s + ")" : s;

    static IEnumerable<(string group, string mode, string expr, string direct)> Vectors()
    {
        // 1. Literal rounding boundaries (half-even at the 28th fractional digit, then 96-bit limit).
        var prefix = "0.123456789012345678901234567"; // 27 fractional digits
        foreach (var last in new[] { "0", "1", "2", "3", "4", "5", "6", "7", "8", "9" })
            foreach (var tail in new[] { "", "4", "5", "50", "500000001", "49999" })
            {
                var lit = prefix + last + tail;
                yield return ("literal-rounding", "decimal", lit, decimal.Parse(lit, NumberStyles.Float, Inv).ToString(Inv));
                yield return ("literal-rounding", "decimal", "-" + lit, null);
            }
        foreach (var lit in new[] { "0.00000000000000000000000000005", "0.00000000000000000000000000015", "0.00000000000000000000000000025",
            "0.000000000000000000000000000051", "7.92281625142643375935439503355", "7.92281625142643375935439503345",
            "79228162514264337593543950335", "79228162514264337593543950334.5", "79228162514264337593543950335.4",
            "79228162514264337593543950335.5", "7922816251426433759354395033.55", "7922816251426433759354395033.45",
            "1E28", "1E-28", "1E-29", "5E-29", "123456789012345678901234567890", "0.1234567890123456789012345678901234" })
            yield return ("literal-rounding", "decimal", lit, null);

        // 2/3/4. Arithmetic: scale reduction, signed division, overflow boundaries.
        var operands = new[] {
            "0", "1", "-1", "3", "-3", "7", "-7", "2", "0.5", "0.1", "1.5", "-2.5",
            "0.0000000001", "0.1234567890123456789", "-0.1234567890123456789",
            "0.0000000000000000000000000001", "1.0000000000000000000000000001",
            "0.9999999999999999999999999999", "7922816251426433759354395033.5",
            MAX, "-" + MAX, "79228162514264337593543950334", "0.5", 
        };
        foreach (var a in operands)
            foreach (var b in operands)
                foreach (var op in new[] { "+", "-", "*", "/" })
                    yield return ("arith-" + op, "decimal", Lit(a) + op + Lit(b), Direct(op, a, b));

        // 4b. Seeded pseudo-random decimals of mixed magnitude and scale (deterministic: fixed seed).
        var rng = new Random(20240601);
        Func<string> randDec = () =>
        {
            int bits = rng.Next(1, 97);
            var parts = new int[3];
            for (int i = 0; i < 3; i++)
            {
                int take = Math.Max(0, Math.Min(32, bits - 32 * i));
                parts[i] = take == 0 ? 0 : (int)(rng.NextInt64() & (take == 32 ? 0xFFFFFFFFL : (1L << take) - 1));
            }
            return new decimal(parts[0], parts[1], parts[2], rng.Next(2) == 1, (byte)rng.Next(0, 29)).ToString(Inv);
        };
        var ops = new[] { "+", "-", "*", "/" };
        for (int i = 0; i < 600; i++)
        {
            var a = randDec();
            var b = randDec();
            var op = ops[i % 4];
            yield return ("random-" + op, "decimal", Lit(a) + op + Lit(b), Direct(op, a, b));
        }
        for (int i = 0; i < 300; i++)
            yield return ("random-decimal-to-float", "decimal", "Float(" + randDec() + ")", null);

        // 5. Float -> Decimal and Decimal -> Float. Doubles are given as text so the Float is exactly that double.
        foreach (var d in new[] { "0.1", "0.30000000000000004", "0.3333333333333333", "0.6666666666666666", "1e28", "9.999999999999999e27",
            "7.922816251426434e28", "7.9228162514264337e28", "1e29", "1e-28", "5e-29", "1.5e-28", "2.5e-28", "1e-29", "123456789.12345679",
            "9007199254740992", "9007199254740993", "-0.1", "4.35", "1.005", "2.675", "1000000000000000.3", "100000000000000.25",
            "123456789012345.6", "1234567890123456.7", "5e-324", "1.7976931348623157e308", "0.000001234567890123456", "999999999999999.9",
            "0.1234567890123456789", "-1e29", "-7.922816251426434e28", "1e15", "1e16", "123456789012345680000" })
        {
            yield return ("float-to-decimal", "decimal", "Decimal(Float(\"" + d + "\"))", null);
            yield return ("float-to-decimal", "float", "Decimal(Float(\"" + d + "\"))", null);
        }
        foreach (var d in new[] { "0.1", "0.3333333333333333333333333333", "79228162514264337593543950335", "0.0000000000000000000000000001", "-7.5", "123456789.123456789" })
            yield return ("decimal-to-float", "decimal", "Float(" + d + ")", null);

        // 6. Mixed Blank/Text/Boolean/Decimal/Float typing, in both modes.
        var mixed = new[] { "Blank()", "\"1\"", "\"2.5\"", "true", "2", "1.5", "Decimal(1.5)", "Float(1.5)" };
        foreach (var mode in new[] { "float", "decimal" })
        {
            foreach (var a in mixed)
            {
                yield return ("mixed-unary", mode, "-" + a, null);
                yield return ("mixed-unary", mode, a + "%", null);
                yield return ("mixed-conv", mode, "Decimal(" + a + ")", null);
                yield return ("mixed-conv", mode, "Float(" + a + ")", null);
                foreach (var b in mixed)
                    foreach (var op in new[] { "+", "*", "/", "^", "=", "<>", "<", ">=" })
                        yield return ("mixed-" + (op.Length == 1 && "+*/^".Contains(op) ? "arith" : "compare"), mode, a + op + b, null);
            }
            foreach (var e in new[] { "If(true,1.5,Float(1))", "If(true,Float(1),1.5)", "If(true,\"1\",1.5)", "If(true,Blank(),1.5)", "If(true,1.5,Blank())",
                "If(false,1.5,Float(1))", "First(Table({a:1.5},{a:Float(2)})).a", "CountRows(Table({a:1.5}))" })
                yield return ("mixed-if", mode, e, null);
        }
    }


    // ---- Culture-aware numeric text parsing (Decimal/Float/Value with text and a locale) ----

    static readonly string[] TextInputs = BuildTextInputs();

    static string[] BuildTextInputs()
    {
        var l = new List<string>();
        void A(params string[] xs) => l.AddRange(xs);
        // plain and signs
        A("0", "1", "-1", "+1", "00012", "-0", "+0", "-0.0", "0.0", "1.5", "-1.5", "+1.5", ".5", "5.", "-.5", "+.5", ".", "-", "+", "--1", "+-1", "-+1", "++1", "- 1", "+ 1", "1 -", "1-", "1+", "1--", "-1-", "+1+", "1-1");
        // whitespace (ASCII, control, Unicode)
        A(" 12", "12 ", "  12  ", "\t12\t", "\u000b12", "12\u000c", "\r12", "12\n", "\u00a012", "12\u00a0", "\u200312\u2003", "\u2009 12", "12\u202f", "\u3000" + "12" + "\u3000", "\u200b12", "\ufeff12", "1 2", "1\u00a02", "1\u202f2", "1\u20092", " ", "\t", "\u00a0", "", "- 12", "-\t12", "12 -", "( 12 )", "(\u00a012\u00a0)");
        // exponents
        A("1e3", "1E3", "1e+3", "1e-3", "1e", "1e+", "1e-", "e3", "1e3.5", "1e 3", "1 e3", "1.5e3", "1.5e-3", "-1.5E+3", "1e0", "0e5", "0e-5", "1e1000", "1e-1000", "1e9999", "1e99999999999", "1e-99999999999", "0e99999999999", "1e28", "1e29", "7.9e28", "1e-28", "1e-29", "1e308", "1e309", "1e-323", "1e-324", "1e-400", "5e-324", "2e-324", "1.7976931348623157e308", "1.7976931348623159e308", "1.7976931348623158e308", "1e+0003", "1e3e3", "1e3%", "12e2 %", "(1e3)", "1e3-", "$1e3", "1e3$");
        // grouping and decimal point (en-US shaped)
        A("1,000", "1,000.5", "1,00", "1,0,0", "1,,000", ",1", "1,", ",", ",,", "1,000,000", "1,00,000", "1,0000", "12,34,56", "1,000.5.5", "1.000,5", "1.000", "1,5", "1.5,5", "1,000e3", "1,000.e3", ".,5", ",.5", "1.,5", "1.5,", "0,001", "0,0", "1 000", "1 000.5", "1\u00a0000.5", "1\u202f000.5", "1\u2009000.5", "1'000", "1_000", "1٬000", "1٫5");
        // parentheses
        A("(12)", "(12", "12)", "((12))", "(-12)", "-(12)", "(12)-", "-(12)-", "(+12)", "+(12)", "()", "(", ")", "(1,000)", "(1.5)", "( 1 )", "(12)%", "%(12)", "(12%)", "(%12)", "12()", "(1)(2)", "(\u00a012)", "$(12)", "($12)", "($ 12)", "(12 $)", "(12$)", "-($12)", "($12)-");
        // currency (en-US $, fr-FR €, others)
        A("$12", "12$", "$ 12", "12 $", "$-12", "-$12", "$+12", "+$12", "$12-", "-$12-", "$12+", "$$12", "12$$", "$12$", "$", "$.", "$.5", "$5.", "$1,000.50", "1,000.50$", "$ 1,000", "-$1,000", "$-1,000", "$(12)", "($12)", "€12", "12€", "12 €", "€ 12", "12\u00a0€", "12\u202f€", "€12,5", "12,5 €", "12,5€", "1 000,5 €", "1\u00a0000,5\u00a0€", "1\u202f000,5\u202f€", "-12 €", "- 12 €", "12 €-", "-€12", "€-12", "£12", "¥12", "¤12", "USD12", "US$12", "12 USD", "R$12", "$12 €", "€12 $", "$€12", "12$€", "$$", "$ $", "$12%", "%$12", "$12 %", "12%$", "$%12", "-$12%", "$-12%", "($12%)");
        // percent
        A("12%", "%12", "12 %", "% 12", " 12% ", "-12%", "%-12", "-%12", "12%-", "+12%", "%+12", "12%%", "%12%", "%%12", "%", "% ", "%%", "12%1", "1%2", "1 % 2", "1,000%", "1.5%", "%1.5", "1e2%", "%1e2", "-0%", "0%", "100%", "50%", "33.333333333333333333333333333333%", "79228162514264337593543950335%", "79228162514264337593543950336%", "7.9228162514264337593543950335e30%", "1e-27%", "1e-29%", "5e-29%", "(12)%", "12%)", "12%(", "12\u00a0%", "\u00a0%12", "12\u202f%", "12 ‰", "12‰", "‰12", "12٪", "1,5%", "1.000,5%", "-12 %", "- 12%", "-12% ", "+ 12%", "12 % ", "12%\t", "12\u2003%");
        // digits and exotic characters
        A("١٢", "１２", "12٫5", "①", "1²", "½", "١٢٣", "1.2.3", "1..2", "0x10", "0b1", "1_0", "1f", "1d", "1L", "NaN", "nan", "Infinity", "-Infinity", "+Infinity", "∞", "-∞", "infinity", "1/2", "1:2", "1;2", "abc", "12abc", "abc12", "12 abc", "true", "false", "--", "−12", "–12", "12−", "+", "−", "1\u0000", "\u000012");
        // 28/29-digit and rounding behavior
        A("79228162514264337593543950335", "79228162514264337593543950336", "-79228162514264337593543950335", "-79228162514264337593543950336", "79228162514264337593543950335.4", "79228162514264337593543950335.5", "79228162514264337593543950334.5", "7922816251426433759354395033.5", "7922816251426433759354395033.55", "0.0000000000000000000000000001", "0.00000000000000000000000000005", "0.00000000000000000000000000015", "0.00000000000000000000000000025", "0.000000000000000000000000000050001", "-0.00000000000000000000000000005", "-0.00000000000000000000000000015", "0.1234567890123456789012345678901234567890", "1.2345678901234567890123456789", "1.23456789012345678901234567895", "1.23456789012345678901234567885", "12345678901234567890123456789.5", "0.99999999999999999999999999995", "0.99999999999999999999999999994", "9999999999999999999999999999.5", "1234567890123456789012345678901234567890", "-1234567890123456789012345678901234567890", "0.30000000000000004", "0.1", "0.3333333333333333333333333333", "0.33333333333333333333333333335", "9007199254740993", "9007199254740993.5", "123456789012345678", "1.00000000000000000000000000000000000001", "1,000,000,000,000,000,000,000,000,000.5", "0.0000000000000000000000000000000000001", "0.000000000000000000000000000000000000000000000000000000000000001", "00000000000000000000000000000000001", "1" + new string('0', 40), "0." + new string('0', 40) + "1", new string('9', 60), "1,"+string.Join(",", Enumerable.Repeat("000", 12)));
        // whitespace after a sign or parenthesis, with and without a currency symbol
        A("€- 12", "€-  12", "$- 12", "$-  12", "($ 12)", "($  12)", "( $12)", "( $ 12)", "(€ 12)", "(€  12)", "( €12)", "(12 $)", "(12 €)", "($ 12 )", "(\t$\t12\t)", "$ (12)", "€ (12)", "$ - 12", "€ + 12", "$+ 12", "(- 12)", "( 12)", "(12 )", "(\u00a0$12)", "($\u00a012)", "(€\u00a012)", "(€\u202f12)", "(\u202f€12)", "$ 12 -", "$12 -", "$12- ", "12 - $", "12 $ -", "12- $", "(12) $", "(12)$", "(12 $)", "$ (12) ");
        // trim and Unicode white space
        A("\u008512", "12\u0085", "\u168012", "\u200012", "\u200a12", "\u202812", "\u202912", "\u205f12", "\u001c12", "\u001f12", "\u180e12", "\u200b 12", "\u0085%12", "12%\u0085", "-\u008512", "12\u0085-");
        // fr-FR shaped
        A("1,5", "1,", ",5", "-1,5", "1 000,5", "1\u00a0000,5", "1\u202f000,5", "1.000,5", "1,000.5", "1 000", "1\u00a0000", "1\u202f000", "1\u202f000\u202f000", "1\u00a0000\u202f000", "1 000 000,25", "1  000", "1\u00a0\u00a0000", " 1 000,5 ", "1 00", "1 0000", "1 000,5,5", "1,5 000", "1 000,5 000", "12,5%", "%12,5", "12,5 %", "-12,5 %", "1 000,5%", "(12,5)", "(1 000,5)", "12,5-", "-12,5", "−12,5", "12,5e3", "1,5E-3", "1,5e", "1.5", "1.500", "1.5.5", "1,5,5");
        return l.ToArray();
    }

    static string Q(string s) => "\"" + s.Replace("\"", "\"\"") + "\"";

    static IEnumerable<(string group, string mode, string expr)> TextVectors()
    {
        foreach (var mode in new[] { "decimal", "float" })
        {
            foreach (var t in TextInputs)
            {
                var q = Q(t);
                yield return ("text-decimal", mode, $"Decimal({q})");
                yield return ("text-float", mode, $"Float({q})");
                yield return ("text-value", mode, $"Value({q})");
                yield return ("text-implicit", mode, $"{q}+1");
                foreach (var loc in new[] { "en-US", "fr-FR" })
                {
                    yield return ($"text-decimal-{loc}", mode, $"Decimal({q},\"{loc}\")");
                    yield return ($"text-float-{loc}", mode, $"Float({q},\"{loc}\")");
                }
                yield return ("text-value-fr-FR", mode, $"Value({q},\"fr-FR\")");
            }
            // locale argument: names (case, separators, neutral, invariant, unknown)
            foreach (var name in new[] { "en-US", "en-us", "EN-US", "fr-FR", "fr-fr", "FR-FR", "en", "fr", "", " ", "en-US ", " fr-FR", "en_US", "fr_FR", "de-DE", "es-ES", "ja-JP", "ar-SA", "xx", "xx-YY", "en-XX", "123", "-", "en-", "fr-CA", "en-GB", "en-CA", "pt-BR", "ru-RU", "sv-SE", "de-CH", "invariant", "iv", "x-klingon", "en-US-x-twain", "fr-FR_u_nu" })
            {
                yield return ("locale-name", mode, $"Decimal(\"1234,5\",{Q(name)})");
                yield return ("locale-name-float", mode, $"Float(\"1234.5\",{Q(name)})");
            }
            // blank / error / type behavior of the optional argument
            foreach (var e in new[] {
                "Decimal(Blank())", "Float(Blank())", "Decimal(\"\")", "Float(\"\")", "Decimal(\"\",\"fr-FR\")", "Decimal(\"\",\"xx\")", "Float(\"\",\"xx\")",
                "Decimal(\"1\",Blank())", "Float(\"1\",Blank())", "Decimal(Blank(),\"fr-FR\")", "Decimal(Blank(),\"xx\")", "Decimal(Blank(),Blank())",
                "Decimal(\"1,5\",Blank())", "Decimal(\"x\",\"xx\")", "Decimal(\"x\",\"fr-FR\")", "Decimal(1,\"xx\")", "Float(1,\"xx\")", "Decimal(true,\"xx\")", "Decimal(2.5,\"fr-FR\")", "Float(2.5,\"fr-FR\")", "Decimal(true,\"fr-FR\")", "Float(false,\"en-US\")",
                "Decimal(1/0)", "Decimal(1/0,\"fr-FR\")", "Decimal(\"1\",1/0)", "Decimal(1/0,1/0)", "Float(1/0,\"xx\")", "Decimal(\"1\",If(true,1/0,\"fr-FR\"))", "Decimal(\"1,5\",If(true,\"fr-FR\",1/0))",
                "Decimal(\"1\",1)", "Decimal(\"1\",true)", "Decimal(1,2)", "Float(\"1\",\"en-US\",\"x\")", "Decimal()", "Float()", "Value()", "Value(\"1\",\"fr-FR\",\"x\")",
                "Decimal({a:1})", "Float(Table({a:1}))", "Decimal(\"1\",{a:1})",
                "Decimal(If(false,\"1\"))", "Decimal(\"1\",If(false,\"fr-FR\"))", "Decimal(If(true,\"1,5\"),If(true,\"fr-FR\"))",
                "If(false,1/0,Decimal(\"1,5\",\"fr-FR\"))", "Decimal(\"1,5\",\"fr-FR\")+1", "Decimal(\"1,5\",\"fr-FR\")*2", "Float(\"1,5\",\"fr-FR\")*2", "Decimal(\"1,5\",\"fr-FR\")=1.5", "Float(\"1,5\",\"fr-FR\")=1.5",
                "Decimal(Decimal(\"1,5\",\"fr-FR\"),\"xx\")", "Decimal(Decimal(\"1,5\",\"fr-FR\"))",
                "\"1,5\"+\"2,5\"", "\"$1,000\"*2", "-\"1,000\"", "\"12%\"+1", "\"1,000\"=1000", "\"1,000\">999", "If(\"1,5\">1,1,2)",
                "\" \"+1", "\"\"+1", "-\"\"", "\"\"=0", "\"\"=Blank()", "IsBlank(Decimal(\"\"))", "IsBlank(\"\"+1)",
            })
                yield return ("text-misc", mode, e);
        }
    }

    static int GenerateText(string outPath)
    {
        var engines = new Dictionary<string, RecalcEngine> { ["float"] = Engine("float"), ["decimal"] = Engine("decimal") };
        var entries = new List<object>();
        foreach (var (group, mode, expr) in TextVectors())
        {
            var (kind, value) = Run(engines[mode], mode, expr);
            entries.Add(new { group, mode, expr, kind, value });
        }
        var cultures = new List<object>();
        foreach (var name in new[] { "en-US", "fr-FR", "" })
        {
            var c = CultureInfo.GetCultureInfo(name);
            var n = c.NumberFormat;
            cultures.Add(new
            {
                name,
                decimalSeparator = n.NumberDecimalSeparator,
                groupSeparator = n.NumberGroupSeparator,
                currencySymbol = n.CurrencySymbol,
                currencyDecimalSeparator = n.CurrencyDecimalSeparator,
                currencyGroupSeparator = n.CurrencyGroupSeparator,
                positiveSign = n.PositiveSign,
                negativeSign = n.NegativeSign,
                numberNegativePattern = n.NumberNegativePattern,
                currencyNegativePattern = n.CurrencyNegativePattern,
                currencyPositivePattern = n.CurrencyPositivePattern,
                nanSymbol = n.NaNSymbol,
                positiveInfinitySymbol = n.PositiveInfinitySymbol,
            });
        }
        var opts = new JsonSerializerOptions { Encoder = System.Text.Encodings.Web.JavaScriptEncoder.Default };
        var sb = new StringBuilder();
        sb.Append("{\"upstream\":\"df4ceba5e08220db670c25afead342ce699c50b5\",\"generator\":\"tools/reference-harness generate-text\",\"runtime\":\"" + System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription + "\",\"cultures\":" + JsonSerializer.Serialize(cultures, opts) + ",\"entries\":[\n");
        sb.Append(string.Join(",\n", entries.Select(x => JsonSerializer.Serialize(x, opts))));
        sb.Append("\n]}\n");
        File.WriteAllText(outPath, sb.ToString());
        Console.Error.WriteLine($"{entries.Count} text vectors");
        return 0;
    }

    static int GenerateRegistry(string outPath)
    {
        const string upstreamCommit = "df4ceba5e08220db670c25afead342ce699c50b5";
        const string coreTypeName = "Microsoft.PowerFx.Core.Texl.BuiltinFunctionsCore";
        const string sourcePath = "src/libraries/Microsoft.PowerFx.Core/Texl/BuiltinFunctionsCore.cs";
        var upstreamDirectory = Path.Combine(Directory.GetCurrentDirectory(), "upstream", "Power-Fx");
        var git = new Process
        {
            StartInfo = new ProcessStartInfo("git")
            {
                WorkingDirectory = upstreamDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            },
        };
        git.StartInfo.ArgumentList.Add("rev-parse");
        git.StartInfo.ArgumentList.Add("HEAD");
        if (!git.Start())
            throw new InvalidOperationException("Could not start git to verify the pinned upstream checkout.");
        var actualCommit = git.StandardOutput.ReadToEnd().Trim();
        var gitError = git.StandardError.ReadToEnd();
        git.WaitForExit();
        if (git.ExitCode != 0 || actualCommit != upstreamCommit)
            throw new InvalidOperationException(
                $"Registry extraction requires upstream/Power-Fx at {upstreamCommit}; found {actualCommit}. {gitError}".Trim());

        _ = Engine("decimal");
        var core = AppDomain.CurrentDomain.GetAssemblies()
            .Select(assembly => assembly.GetType(coreTypeName))
            .FirstOrDefault(type => type != null)
            ?? throw new InvalidOperationException($"Could not load upstream type {coreTypeName}.");
        const BindingFlags staticFlags = BindingFlags.Static | BindingFlags.Public | BindingFlags.NonPublic;
        const BindingFlags instanceFlags = BindingFlags.Instance | BindingFlags.Public | BindingFlags.NonPublic;
        var fieldsByInstance = core.GetFields(staticFlags)
            .Where(field => field.FieldType.Name == "TexlFunction")
            .Select(field => (Field: field, Value: field.GetValue(null)))
            .Where(item => item.Value != null)
            .ToDictionary(item => item.Value, item => item.Field.Name, ReferenceEqualityComparer.Instance);

        IEnumerable RegistryFunctions(string fieldName)
        {
            var set = core.GetField(fieldName, staticFlags)?.GetValue(null)
                ?? throw new InvalidOperationException($"Could not read upstream registry {fieldName}.");
            var property = set.GetType().GetProperty("Functions", instanceFlags)
                ?? throw new InvalidOperationException($"Could not read functions from upstream registry {fieldName}.");
            return (IEnumerable)(property.GetValue(set)
                ?? throw new InvalidOperationException($"Upstream registry {fieldName} returned no functions."));
        }

        var rows = new List<(string Registry, string Name, string Registration, string Implementation)>();
        void AddRegistry(string registry, string fieldName)
        {
            foreach (var function in RegistryFunctions(fieldName))
            {
                var name = (string)(function.GetType().GetProperty("Name", instanceFlags)?.GetValue(function)
                    ?? throw new InvalidOperationException($"Could not read function name in {fieldName}."));
                rows.Add((registry, name, fieldsByInstance.GetValueOrDefault(function) ?? "",
                    function.GetType().Name));
            }
        }

        AddRegistry("SharedCore", "_library");
        AddRegistry("FeatureGatedCore", "_featureGateFunctions");

        var otherKnown = (IEnumerable)(core.GetField("OtherKnownFunctions", staticFlags)?.GetValue(null)
            ?? throw new InvalidOperationException("Could not read upstream OtherKnownFunctions."));
        rows.AddRange(otherKnown.Cast<string>().Select(name =>
            ("OtherKnownFunctions", name, "", "")));

        var lines = new List<string>
        {
            "upstream_commit\tregistry\tcanonical_name\tregistration_field\timplementation_type\tsource_path",
        };
        lines.AddRange(rows
            .OrderBy(row => row.Registry, StringComparer.Ordinal)
            .ThenBy(row => row.Name, StringComparer.OrdinalIgnoreCase)
            .ThenBy(row => row.Registration, StringComparer.Ordinal)
            .Select(row => $"{upstreamCommit}\t{row.Registry}\t{row.Name}\t{row.Registration}\t{row.Implementation}\t{sourcePath}"));
        File.WriteAllText(outPath, string.Join("\n", lines) + "\n");
        Console.Error.WriteLine($"{rows.Count} rows: " +
            $"{rows.Count(row => row.Registry == "SharedCore")} shared Core, " +
            $"{rows.Count(row => row.Registry == "FeatureGatedCore")} feature-gated Core, " +
            $"{rows.Count(row => row.Registry == "OtherKnownFunctions")} OtherKnownFunctions");
        return 0;
    }

    sealed record CaseRange(int Start, int End, int Delta);

    static int CaseMapCommand(string action, string path)
    {
        const string upstreamCommit = "df4ceba5e08220db670c25afead342ce699c50b5";
        const string upstreamDirectoryName = "upstream/Power-Fx";
        var upstreamDirectory = Path.Combine(Directory.GetCurrentDirectory(), upstreamDirectoryName);
        var git = new Process
        {
            StartInfo = new ProcessStartInfo("git")
            {
                WorkingDirectory = upstreamDirectory,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
            },
        };
        git.StartInfo.ArgumentList.Add("rev-parse");
        git.StartInfo.ArgumentList.Add("HEAD");
        if (!git.Start())
            throw new InvalidOperationException("Could not start git to verify the pinned upstream checkout.");
        var actualCommit = git.StandardOutput.ReadToEnd().Trim();
        var gitError = git.StandardError.ReadToEnd();
        git.WaitForExit();
        if (git.ExitCode != 0 || actualCommit != upstreamCommit)
            throw new InvalidOperationException(
                $"Case-map generation requires upstream/Power-Fx at {upstreamCommit}; found {actualCommit}. {gitError}".Trim());

        var textInfo = CultureInfo.GetCultureInfo("en-US").TextInfo;
        if (action == "generate")
        {
            var lower = BuildCaseRanges(textInfo, upper: false);
            var upper = BuildCaseRanges(textInfo, upper: true);
            VerifyCaseRanges(textInfo, lower, upper);
            File.WriteAllText(path, RenderCaseMap(lower, upper, upstreamCommit));
            Console.Error.WriteLine(
                $"Verified all Unicode scalar values; generated {lower.Count} lowercase and {upper.Count} uppercase ranges.");
            return 0;
        }

        if (action == "verify")
        {
            var source = File.ReadAllText(path);
            var lower = ReadCaseRanges(source, "LOWER_EN_US");
            var upper = ReadCaseRanges(source, "UPPER_EN_US");
            VerifyCaseRanges(textInfo, lower, upper);
            Console.Error.WriteLine(
                $"Verified all Unicode scalar values against {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription} en-US TextInfo.");
            return 0;
        }

        throw new ArgumentException($"Unknown case-map action '{action}'. Use generate or verify.");
    }

    static List<CaseRange> BuildCaseRanges(TextInfo textInfo, bool upper)
    {
        var ranges = new List<CaseRange>();
        for (var codePoint = 0; codePoint <= 0x10FFFF; codePoint++)
        {
            if (codePoint is >= 0xD800 and <= 0xDFFF) continue;
            var source = new Rune(codePoint).ToString();
            var mapped = upper ? textInfo.ToUpper(source) : textInfo.ToLower(source);
            if (!Rune.TryGetRuneAt(mapped, 0, out var target) || target.Utf16SequenceLength != mapped.Length)
                throw new InvalidOperationException(
                    $"en-US TextInfo expanded U+{codePoint:X} to more than one Unicode scalar.");
            if (target.Value == codePoint) continue;

            var delta = target.Value - codePoint;
            if (ranges.Count > 0 && ranges[^1].End == codePoint - 1 && ranges[^1].Delta == delta)
                ranges[^1] = ranges[^1] with { End = codePoint };
            else
                ranges.Add(new CaseRange(codePoint, codePoint, delta));
        }
        return ranges;
    }

    static void VerifyCaseRanges(TextInfo textInfo, IReadOnlyList<CaseRange> lower, IReadOnlyList<CaseRange> upper)
    {
        VerifyCaseRanges(textInfo, lower, upperCase: false);
        VerifyCaseRanges(textInfo, upper, upperCase: true);
    }

    static void VerifyCaseRanges(
        TextInfo textInfo,
        IReadOnlyList<CaseRange> ranges,
        bool upperCase)
    {
        for (var codePoint = 0; codePoint <= 0x10FFFF; codePoint++)
        {
            if (codePoint is >= 0xD800 and <= 0xDFFF) continue;
            var source = new Rune(codePoint).ToString();
            var reference = upperCase ? textInfo.ToUpper(source) : textInfo.ToLower(source);
            if (!Rune.TryGetRuneAt(reference, 0, out var referenceRune) ||
                referenceRune.Utf16SequenceLength != reference.Length)
                throw new InvalidOperationException(
                    $"en-US TextInfo expanded U+{codePoint:X} to more than one Unicode scalar.");
            var mapped = ApplyCaseRanges(codePoint, ranges);
            if (mapped != referenceRune.Value)
                throw new InvalidOperationException(
                    $"Case-map mismatch at U+{codePoint:X}: table U+{mapped:X}, reference U+{referenceRune.Value:X}.");
        }
    }

    static int ApplyCaseRanges(int codePoint, IReadOnlyList<CaseRange> ranges)
    {
        var low = 0;
        var high = ranges.Count - 1;
        while (low <= high)
        {
            var middle = low + (high - low) / 2;
            var range = ranges[middle];
            if (codePoint < range.Start) high = middle - 1;
            else if (codePoint > range.End) low = middle + 1;
            else return codePoint + range.Delta;
        }
        return codePoint;
    }

    static string RenderCaseMap(IReadOnlyList<CaseRange> lower, IReadOnlyList<CaseRange> upper, string upstreamCommit)
    {
        static void AppendRanges(StringBuilder output, string name, IReadOnlyList<CaseRange> ranges)
        {
            output.AppendLine($"export const {name}: readonly (readonly [number, number, number])[] = [");
            foreach (var range in ranges)
                output.AppendLine($"  [0x{range.Start:x}, 0x{range.End:x}, {range.Delta}],");
            output.AppendLine("];");
            output.AppendLine();
        }

        var output = new StringBuilder();
        output.AppendLine("// Frozen en-US simple casing from the pinned Power Fx TextInfo reference.");
        output.AppendLine($"// Upstream: {upstreamCommit}; runtime: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}; culture: en-US.");
        output.AppendLine("// Regenerate only with explicit review; see docs/research/scalar-text-probes/README.md.");
        output.AppendLine();
        AppendRanges(output, "LOWER_EN_US", lower);
        AppendRanges(output, "UPPER_EN_US", upper);
        return output.ToString();
    }

    static List<CaseRange> ReadCaseRanges(string source, string name)
    {
        var section = Regex.Match(
            source,
            $@"export const {Regex.Escape(name)}:[^\n]*= \[\n(.*?)\n\];",
            RegexOptions.Singleline);
        if (!section.Success) throw new InvalidDataException($"Could not find generated mapping {name}.");
        var ranges = new List<CaseRange>();
        foreach (Match match in Regex.Matches(
            section.Groups[1].Value,
            @"^\s*\[0x([0-9a-fA-F]+), 0x([0-9a-fA-F]+), (-?\d+)\],\s*$",
            RegexOptions.Multiline))
        {
            ranges.Add(new CaseRange(
                Convert.ToInt32(match.Groups[1].Value, 16),
                Convert.ToInt32(match.Groups[2].Value, 16),
                int.Parse(match.Groups[3].Value, CultureInfo.InvariantCulture)));
        }
        if (ranges.Count == 0) throw new InvalidDataException($"Generated mapping {name} is empty or malformed.");
        for (var i = 0; i < ranges.Count; i++)
        {
            if (ranges[i].Start > ranges[i].End ||
                (i > 0 && ranges[i - 1].End >= ranges[i].Start))
                throw new InvalidDataException($"Generated mapping {name} is not ordered and disjoint.");
        }
        return ranges;
    }

    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "generate-text") return GenerateText(args[1]);
        if (args.Length >= 2 && args[0] == "registry") return GenerateRegistry(args[1]);
        if (args.Length >= 3 && args[0] == "case-map") return CaseMapCommand(args[1], args[2]);
        if (args.Length >= 3 && args[0] == "count-cast-probe")
        {
            Console.WriteLine($"# Framework: {System.Runtime.InteropServices.RuntimeInformation.FrameworkDescription}");
            Console.WriteLine($"# Runtime version: {Environment.Version}");
            Console.WriteLine($"# OS: {System.Runtime.InteropServices.RuntimeInformation.OSDescription}");
            Console.WriteLine($"# Process architecture: {System.Runtime.InteropServices.RuntimeInformation.ProcessArchitecture}");
            Console.WriteLine($"# Profile: {args[1]}, Features.PowerFxV1, en-US, UTC");
            Console.WriteLine("expression\tfloat\tunchecked-int32");
            var e = Engine(args[1]);
            var opts = new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = args[1] == "float" };
            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var expression = $"Float({line})";
                var check = e.Check(expression, opts);
                if (!check.IsSuccess)
                    throw new InvalidDataException($"Count-cast probe did not compile: {expression}");
                var value = e.EvalAsync(expression, System.Threading.CancellationToken.None, opts).GetAwaiter().GetResult();
                if (value is not NumberValue number)
                    throw new InvalidDataException($"Count-cast probe did not produce Float: {expression}");
                Console.WriteLine($"{line}\t{number.Value.ToString("R", Inv)}\t{unchecked((int)number.Value)}");
            }
            return 0;
        }
        if (args.Length >= 3 && args[0] == "check")
        {
            // Full compile-error list, as the corpus `Errors:` expectation prints it.
            var e = Engine(args[1]);
            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var c = e.Check(line, new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = args[1] == "float" });
                var errs = c.Errors.Where(x => !x.IsWarning).Select(x => x.ToString());
                Console.WriteLine($"{line}\n   => {(c.IsSuccess ? "OK" : string.Join("|", errs))}");
            }
            return 0;
        }
        if (args.Length >= 3 && args[0] == "probe")
        {
            // Static result type (CheckResult.ReturnType), compile errors, and the full value
            // (FormulaValue.ToExpression, so multi-error values and record shapes are visible).
            // Output: tab-separated `expr`, canonical `type`, canonical `result`; a result starting with `ERRORS:` is a compile failure.
            var e = Engine(args[1]);
            var opts = new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = args[1] == "float" };
            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var c = e.Check(line, opts);
                var type = c.ReturnType == null ? "" : SerType(c.ReturnType);
                if (!c.IsSuccess)
                {
                    Console.WriteLine($"{line}\t{type}\tERRORS:{string.Join("|", c.Errors.Where(x => !x.IsWarning).Select(x => x.ToString()))}");
                    continue;
                }
                string result;
                try
                {
                    var v = e.EvalAsync(line, System.Threading.CancellationToken.None, opts).GetAwaiter().GetResult();
                    result = SerValue(v);
                }
                catch (Exception x) { result = "EXCEPTION:" + (x.InnerException?.Message ?? x.Message).Split('\n')[0]; }
                Console.WriteLine($"{line}\t{type}\t{result}");
            }
            return 0;
        }
        if (args.Length >= 3 && args[0] == "showcolumns-probe")
        {
            // Exposes schema order, runtime field enumeration, and Power Fx serialization
            // independently; the ordinary probe intentionally canonicalizes schema fields.
            var e = Engine(args[1]);
            var opts = new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = args[1] == "float" };
            static string TypeOrder(FormulaType type)
            {
                var recordType = type switch
                {
                    RecordType record => record,
                    TableType table => table.ToRecord(),
                    _ => null
                };
                return recordType == null
                    ? ""
                    : string.Join(",", recordType.GetFieldTypes().Select(field => field.Name));
            }
            static string RuntimeOrder(FormulaValue value)
            {
                static string RecordOrder(RecordValue record) =>
                    string.Join(",", record.Fields.Select(field => field.Name));
                return value switch
                {
                    RecordValue record => RecordOrder(record),
                    TableValue table => string.Join(";", table.Rows.Select(row =>
                        row.IsValue ? RecordOrder(row.Value) :
                        row.IsBlank ? "Blank" : row.ToFormulaValue().GetType().Name)),
                    _ => value.GetType().Name
                };
            }
            static string Diagnostics(CheckResult check)
            {
                var diagnostics = string.Join("|", check.Errors.Select(error =>
                    $"{error.Severity}@{error.Span.Min}-{error.Span.Lim}:{error.Message}"));
                return diagnostics.Length == 0 ? "-" : diagnostics;
            }

            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var check = e.Check(line, opts);
                var typeOrder = check.ReturnType == null ? "" : TypeOrder(check.ReturnType);
                var status = check.IsSuccess ? "valid" : "invalid";
                if (!check.IsSuccess)
                {
                    Console.WriteLine($"{line}\t{status}\t{typeOrder}\t\t\t{Diagnostics(check)}");
                    continue;
                }

                var value = e.EvalAsync(line, System.Threading.CancellationToken.None, opts).GetAwaiter().GetResult();
                Console.WriteLine($"{line}\t{status}\t{typeOrder}\t{RuntimeOrder(value)}\t{value.ToExpression()}\t{Diagnostics(check)}");
            }
            return 0;
        }
        if (args.Length >= 3 && args[0] == "renamecolumns-probe")
        {
            // Keep reference binding, value ordering, serialization, and runtime exceptions distinct.
            var e = Engine(args[1]);
            var opts = new ParserOptions { Culture = new CultureInfo("en-US"), NumberIsFloat = args[1] == "float" };
            static string TypeOrder(FormulaType type)
            {
                var recordType = type switch
                {
                    RecordType record => record,
                    TableType table => table.ToRecord(),
                    _ => null
                };
                return recordType == null
                    ? ""
                    : string.Join(",", recordType.GetFieldTypes().Select(field => field.Name));
            }
            static string RuntimeOrder(FormulaValue value)
            {
                static string RecordOrder(RecordValue record) =>
                    string.Join(",", record.Fields.Select(field => field.Name));
                return value switch
                {
                    RecordValue record => RecordOrder(record),
                    TableValue table => string.Join(";", table.Rows.Select(row =>
                        row.IsValue ? RecordOrder(row.Value) :
                        row.IsBlank ? "Blank" : "ErrorValue")),
                    _ => value.GetType().Name
                };
            }
            static string Diagnostics(CheckResult check)
            {
                var diagnostics = string.Join("|", check.Errors.Select(error =>
                    $"{error.Severity}@{error.Span.Min}-{error.Span.Lim}:{error.Message}"));
                return diagnostics.Length == 0 ? "-" : diagnostics;
            }

            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var check = e.Check(line, opts);
                var typeOrder = check.ReturnType == null ? "" : TypeOrder(check.ReturnType);
                var status = check.IsSuccess ? "valid" : "invalid";
                if (!check.IsSuccess)
                {
                    Console.WriteLine($"{line}\t{status}\t{typeOrder}\t\t\t{Diagnostics(check)}\t-");
                    continue;
                }

                string runtimeOrder = "";
                string serialized = "";
                string runtimeException = "-";
                try
                {
                    var value = e.EvalAsync(line, System.Threading.CancellationToken.None, opts).GetAwaiter().GetResult();
                    runtimeOrder = RuntimeOrder(value);
                    serialized = value.ToExpression();
                }
                catch (Exception exception)
                {
                    runtimeException = (exception.InnerException?.Message ?? exception.Message).Split('\n')[0];
                }

                Console.WriteLine($"{line}\t{status}\t{typeOrder}\t{runtimeOrder}\t{serialized}\t{Diagnostics(check)}\t{runtimeException}");
            }
            return 0;
        }
        if (args.Length >= 3 && args[0] == "eval")
        {
            var e = Engine(args[1]);
            foreach (var line in File.ReadAllLines(args[2]).Where(l => l.Trim() != ""))
            {
                var (k, v) = Run(e, args[1], line);
                Console.WriteLine($"{line}\n   => {k}:{v}");
            }
            return 0;
        }
        if (args.Length >= 2 && args[0] == "generate")
        {
            var engines = new Dictionary<string, RecalcEngine> { ["float"] = Engine("float"), ["decimal"] = Engine("decimal") };
            var entries = new List<object>();
            int compared = 0, disagree = 0;
            foreach (var (group, mode, expr, direct) in Vectors())
            {
                var (kind, value) = Run(engines[mode], mode, expr);
                bool? agrees = null;
                if (direct != null && (group.StartsWith("arith-") || group.StartsWith("random-") || group == "literal-rounding"))
                {
                    compared++;
                    var actual = kind == "Error" ? value : kind == "Decimal" ? value : "(" + kind + ")";
                    var norm = (string s) => decimal.TryParse(s, NumberStyles.Float, Inv, out var d) ? d.ToString(Inv) : s;
                    var expectedNorm = direct == "Numeric" || direct == "Div0" ? direct : norm(direct);
                    var actualNorm = kind == "Error" ? (value == "Numeric" || value == "Div0" ? value : "Error:" + value) : norm(actual);
                    agrees = expectedNorm == actualNorm;
                    if (agrees == false) { disagree++; Console.Error.WriteLine($"System.Decimal vs Power Fx: {expr}: {direct} vs {kind}:{value}"); }
                }
                entries.Add(new { group, mode, expr, kind, value, direct, directAgrees = agrees });
            }
            var opts = new JsonSerializerOptions { DefaultIgnoreCondition = System.Text.Json.Serialization.JsonIgnoreCondition.WhenWritingNull, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping };
            var sbOut = new StringBuilder();
            sbOut.Append("{\"upstream\":\"df4ceba5e08220db670c25afead342ce699c50b5\",\"generator\":\"tools/reference-harness\",\"entries\":[\n");
            sbOut.Append(string.Join(",\n", entries.Select(x => JsonSerializer.Serialize(x, opts))));
            sbOut.Append("\n]}\n");
            File.WriteAllText(args[1], sbOut.ToString());
            Console.Error.WriteLine($"{entries.Count} vectors; {compared} cross-checked against System.Decimal; {disagree} disagreements");
            return 0;
        }
        if (args.Length >= 2 && args[0] == "parse")
        {
            // Raw System.Decimal parsing, which the compat runner's expectation comparison mirrors.
            var inputs = new List<string>();
            foreach (var sign in new[] { "", "-" })
            {
                foreach (var kept in new[] { "0", "1", "2", "3", "4" })
                    foreach (var tail in new[] { "4", "49999", "5", "50000", "50001", "5000000001", "6" })
                        inputs.Add($"{sign}0.{new string('0', 27)}{kept}{tail}");
                foreach (var kept in new[] { "7922816251426433759354395032", "7922816251426433759354395033", "7922816251426433759354395034" })
                    foreach (var tail in new[] { "4", "49", "5", "50", "501", "6" })
                        inputs.Add($"{sign}{kept}.{tail}");
                inputs.Add($"{sign}79228162514264337593543950335.5");
                inputs.Add($"{sign}79228162514264337593543950334.5");
                inputs.Add($"{sign}79228162514264337593543950335.49");
                inputs.Add($"{sign}0.00000000000000000000000000005");
                inputs.Add($"{sign}0.00000000000000000000000000015");
                inputs.Add($"{sign}0.00000000000000000000000000025");
                inputs.Add($"{sign}0.00000000000000000000000000035");
            }
            var rows = inputs.Select(t => new { input = t, parsed = decimal.TryParse(t, NumberStyles.Float, Inv, out var d) ? d.ToString(Inv) : "Overflow" });
            File.WriteAllText(args[1], "{\"generator\":\"tools/reference-harness parse\",\"entries\":[\n" + string.Join(",\n", rows.Select(r => JsonSerializer.Serialize(r))) + "\n]}\n");
            Console.Error.WriteLine($"{inputs.Count} parse vectors");
            return 0;
        }
        Console.Error.WriteLine("usage: eval <float|decimal> <file> | generate <out.json> | parse <out.json>");
        return 2;
    }
}
