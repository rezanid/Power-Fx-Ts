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

    static int Main(string[] args)
    {
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
