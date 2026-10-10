// Reference harness: evaluates expressions with the pinned upstream Power Fx (C#) and emits JSON
// vectors that the TypeScript tests replay. Nothing here is derived from the TypeScript code.
//
//   dotnet run --project tools/reference-harness -- eval <float|decimal> <file>   one expression per line
//   dotnet run --project tools/reference-harness -- generate <out.json>           differential fixture
//
// "float" = RecalcEngine(numberIsFloat: true) (profile v1-float); "decimal" = default PowerFxV1
// (profile v1-decimal). Both use Features.PowerFxV1 and en-US.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Text;
using System.Text.Json;
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

    static int Main(string[] args)
    {
        if (args.Length >= 2 && args[0] == "generate-text") return GenerateText(args[1]);
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
