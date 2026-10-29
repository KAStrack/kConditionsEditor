<?php

declare(strict_types=1);

/**
 * Dependency-free conformance runner.
 *
 * Runs the shared fixtures in tests/fixtures/cases.json against the PHP SDK
 * without needing Composer or PHPUnit:
 *
 *     php tests/php/conformance.php
 *
 * The PHPUnit suite in sdk/php/tests covers the same ground plus the unit
 * tests; this script exists so parity can be checked anywhere PHP runs.
 */

namespace Kastrack\ConditionsEditor\ConformanceRunner;

use Kastrack\ConditionsEditor\EvaluationResult;
use Kastrack\ConditionsEditor\Evaluator;
use Kastrack\ConditionsEditor\Exception\ConditionException;
use Kastrack\ConditionsEditor\Skip;
use Kastrack\ConditionsEditor\SqlBuilder;
use Kastrack\ConditionsEditor\Support\Labels;

use function Kastrack\ConditionsEditor\evaluate;

require __DIR__ . '/../../sdk/php/autoload.php';

$root = dirname(__DIR__, 2);
$passed = 0;
$failed = 0;

/** @var array<int, string> $failures */
$failures = [];

function check(string $name, callable $fn): void
{
    global $passed, $failed, $failures;
    try {
        $fn();
        $passed++;
        fwrite(STDOUT, "  ok   {$name}\n");
    } catch (\Throwable $e) {
        $failed++;
        $failures[] = $name . ': ' . $e->getMessage();
        fwrite(STDOUT, "  FAIL {$name}\n       " . $e->getMessage() . "\n");
    }
}

function assertSame(mixed $expected, mixed $actual, string $message = ''): void
{
    if ($expected !== $actual) {
        throw new \RuntimeException(sprintf(
            '%sexpected %s, got %s',
            $message === '' ? '' : $message . ' — ',
            var_export($expected, true),
            var_export($actual, true)
        ));
    }
}

function assertTrue(bool $value, string $message = 'expected true'): void
{
    if (!$value) {
        throw new \RuntimeException($message);
    }
}

/* ------------------------------------------------------------------ *
 * Shared fixtures
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "Shared fixtures\n");

$fixtures = json_decode((string) file_get_contents($root . '/tests/fixtures/cases.json'), true);

foreach ($fixtures['cases'] as $case) {
    check($case['name'], static function () use ($case): void {
        $evaluator = new Evaluator($case['options'] ?? []);

        if (!empty($case['expectThrows'])) {
            try {
                $evaluator->evaluateDetailed($case['document'], $case['data'] ?? []);
            } catch (ConditionException) {
                return;
            }
            throw new \RuntimeException('expected a ConditionException');
        }

        $details = $evaluator->evaluateDetailed($case['document'], $case['data'] ?? []);
        assertSame($case['expected'], $details->result, 'boolean result');

        foreach (($case['expectSkipped'] ?? []) as $expected) {
            assertTrue(
                in_array($expected, array_column($details->skipped, 'operator'), true),
                sprintf('expected "%s" among skipped', $expected)
            );
        }
        foreach (($case['expectErrorHandled'] ?? []) as $expected) {
            assertTrue(
                in_array($expected, array_column($details->errors, 'operator'), true),
                sprintf('expected "%s" among handled errors', $expected)
            );
        }
    });
}

/* ------------------------------------------------------------------ *
 * PHP-specific behaviour
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "\nPHP SDK\n");

$doc = static fn (array $children, array $operators = []): array => [
    'version' => '1.0',
    'operators' => $operators,
    'root' => ['type' => 'group', 'operator' => 'and', 'children' => $children],
];
$cond = static fn (string $f, string $o, array $v = []): array => [
    'type' => 'condition', 'field' => $f, 'operator' => $o, 'values' => $v,
];
$lit = static fn (mixed $v): array => ['source' => 'literal', 'value' => $v];

check('registered operator beats the manifest', static function () use ($doc, $cond): void {
    $d = $doc([$cond('email', 'email_is_unique')], [
        'email_is_unique' => ['kind' => 'callback', 'arity' => 0, 'policy' => ['unresolved' => 'skip']],
    ]);
    $ev = (new Evaluator())->registerOperator('email_is_unique', static fn ($v) => $v === 'new@example.com');
    assertSame(true, $ev->evaluate($d, ['email' => 'new@example.com']));
    assertSame(false, $ev->evaluate($d, ['email' => 'taken@example.com']));
});

check('callback may return Skip at runtime', static function () use ($doc, $cond, $lit): void {
    $d = $doc([$cond('state', 'eq', [$lit('Texas')]), $cond('email', 'maybe')], [
        'maybe' => ['kind' => 'callback', 'arity' => 0],
    ]);
    $ev = (new Evaluator())->registerOperator('maybe', static fn () => Skip::instance());
    $details = $ev->evaluateDetailed($d, ['state' => 'Texas', 'email' => 'x@y.z']);
    assertSame(true, $details->result);
    assertSame('callback-skip', $details->skipped[0]['reason']);
});

check('throwing callback follows the error policy', static function () use ($doc, $cond): void {
    $d = $doc([$cond('email', 'boom')], [
        'boom' => ['kind' => 'callback', 'arity' => 0, 'policy' => ['error' => 'skip']],
    ]);
    $ev = (new Evaluator())->registerOperator('boom', static function () {
        throw new \RuntimeException('database is down');
    });
    $details = $ev->evaluateDetailed($d, ['email' => 'x@y.z']);
    assertSame(true, $details->result);
    assertSame('error', $details->skipped[0]['reason']);
});

check('errorPolicy false records the cause', static function () use ($doc, $cond): void {
    $d = $doc([$cond('email', 'boom')], ['boom' => ['kind' => 'callback', 'arity' => 0]]);
    $ev = (new Evaluator(['errorPolicy' => 'false']))->registerOperator('boom', static function () {
        throw new \RuntimeException('database is down');
    });
    $details = $ev->evaluateDetailed($d, ['email' => 'x@y.z']);
    assertSame(false, $details->result);
    assertSame('database is down', $details->errors[0]['message']);
});

check('result hook replaces the return value', static function () use ($doc, $cond, $lit): void {
    $d = $doc([$cond('state', 'eq', [$lit('Texas')])]);
    $options = ['environment' => 'server'];
    $out = evaluate($d, ['state' => 'Texas'], $options, static function (
        array $document,
        array $data,
        array $opts,
        bool $result,
        EvaluationResult $details
    ) use ($d, $options): array {
        assertSame($d, $document);
        assertSame(['state' => 'Texas'], $data);
        assertSame($options, $opts);
        assertSame(true, $result);

        return ['ok' => $result, 'deferred' => count($details->skipped)];
    });
    assertSame(['ok' => true, 'deferred' => 0], $out);
});

check('describe renders the worked example', static function () use ($cond, $lit): void {
    $d = ['version' => '1.0', 'root' => ['type' => 'group', 'operator' => 'and', 'children' => [
        $cond('name', 'regex', [$lit('^ben')]),
        ['type' => 'group', 'operator' => 'or', 'children' => [
            $cond('dob', 'date_before', [$lit('1980')]),
            ['type' => 'group', 'operator' => 'and', 'children' => [
                $cond('dob', 'date_before', [$lit('1982')]),
                $cond('state', 'in_list', [$lit(['Florida', 'Texas'])]),
            ]],
        ]],
    ]]];

    assertSame(
        '([Name] matches regex "^ben" AND ([Date of Birth] is before "1980" OR ([Date of Birth] is before "1982" AND [State] is one of ["Florida", "Texas"])))',
        Evaluator::describe($d, ['fields' => [
            ['name' => 'name', 'label' => 'Name'],
            ['name' => 'dob', 'label' => 'Date of Birth'],
            ['name' => 'state', 'label' => 'State'],
        ]])
    );
});

check('validateDocument catches arity and field problems', static function () use ($doc, $cond, $lit): void {
    $d = $doc([
        $cond('name', 'between', [$lit(1)]),
        $cond('nope', 'eq', [$lit(1)]),
        $cond('name', 'not_an_operator'),
    ]);
    $messages = array_column(Evaluator::validateDocument($d, ['fields' => [['name' => 'name']]]), 'message');
    assertTrue((bool) array_filter($messages, static fn ($m) => str_contains($m, 'expects 2 value(s)')), 'arity problem');
    assertTrue((bool) array_filter($messages, static fn ($m) => str_contains($m, 'Unknown field "nope"')), 'field problem');
    assertTrue((bool) array_filter($messages, static fn ($m) => str_contains($m, 'Unknown operator')), 'operator problem');
});

check('documents may be JSON strings, bare nodes or empty', static function () use ($doc, $cond, $lit): void {
    $d = $doc([$cond('state', 'eq', [$lit('Texas')])]);
    assertSame(true, evaluate((string) json_encode($d), ['state' => 'Texas']));
    assertSame(true, evaluate($d['root'], ['state' => 'Texas']));
    assertSame(true, evaluate($cond('state', 'eq', [$lit('Texas')]), ['state' => 'Texas']));
    assertSame(true, evaluate('', []));
});

check('object data is readable', static function () use ($doc, $cond, $lit): void {
    $d = $doc([$cond('state', 'eq', [$lit('Texas')])]);
    assertSame(true, (new Evaluator())->evaluate($d, (object) ['state' => 'Texas']));
});

check('trace records every evaluated node', static function () use ($doc, $cond, $lit): void {
    $d = $doc([$cond('state', 'eq', [$lit('Texas')])]);
    $details = (new Evaluator(['trace' => true]))->evaluateDetailed($d, ['state' => 'Texas']);
    assertSame(2, count($details->trace ?? []));
    assertSame('condition', $details->trace[0]['type']);
    assertSame('group', $details->trace[1]['type']);
});

/* ------------------------------------------------------------------ *
 * Shared SQL fixtures
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "\nShared SQL fixtures\n");

foreach ($fixtures['sqlCases'] as $case) {
    check($case['name'], static function () use ($case): void {
        $options = $case['options'] ?? [];

        if (!empty($case['expectThrows'])) {
            try {
                (new SqlBuilder($options))->build($case['document']);
            } catch (ConditionException) {
                return;
            }
            throw new \RuntimeException('expected a ConditionException');
        }

        $out = (new SqlBuilder($options))->build($case['document']);
        assertSame($case['expectedSql'], $out['sql'], 'generated SQL');

        if (isset($case['expectedParams'])) {
            assertSame($case['expectedParams'], $out['params'], 'bound parameters');
        }
        foreach (($case['expectSkipped'] ?? []) as $expected) {
            assertTrue(
                in_array($expected, array_column($out['skipped'], 'operator'), true),
                sprintf('expected "%s" among skipped', $expected)
            );
        }
    });
}

/* ------------------------------------------------------------------ *
 * Shared describe() / describeHtml() fixtures
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "\nShared describe fixtures\n");

foreach ($fixtures['describeCases'] as $case) {
    check($case['name'], static function () use ($case): void {
        $options = $case['options'] ?? [];
        assertSame($case['expectedText'], Evaluator::describe($case['document'], $options), 'plain text');
        assertSame($case['expectedHtml'], Evaluator::describeHtml($case['document'], $options), 'HTML');

        // Whatever else changes, nothing from the document may reach the
        // output as live markup.
        $stripped = preg_replace('#</?(span|strong)\b[^>]*>#', '', Evaluator::describeHtml($case['document'], $options));
        assertTrue(
            preg_match('#<(img|script|b)\b#i', (string) $stripped) === 0,
            'no unescaped tags survive'
        );
    });
}

/* ------------------------------------------------------------------ *
 * Label templates — the same helpers as the JavaScript SDK's
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "\nLabel templates\n");

check('fillTemplate fills named placeholders and leaves unknown ones as written', static function (): void {
    assertSame('Remove Florida', Labels::fillTemplate('Remove {value}', ['value' => 'Florida']));
    assertSame('1 0 1', Labels::fillTemplate('{a} {b} {a}', ['a' => 1, 'b' => 0]));
    assertSame('Ta bort {value}', Labels::fillTemplate('Ta bort {value}', []));
    assertSame('{value}', Labels::fillTemplate('{value}', ['value' => null]));
});

check('splitOperatorLabel splits at the first {value}, keeping the spacing', static function (): void {
    assertSame(null, Labels::splitOperatorLabel('is between'));
    assertSame(['head' => 'is within the last', 'before' => ' ', 'after' => ' ', 'tail' => 'days'],
        Labels::splitOperatorLabel('is within the last {value} days'));
    assertSame(['head' => '在过去', 'before' => '', 'after' => '', 'tail' => '天内'], Labels::splitOperatorLabel('在过去{value}天内'));
    assertSame(['head' => '', 'before' => '', 'after' => ' ', 'tail' => 'or more '], Labels::splitOperatorLabel('{value} or more {value}'));
    assertSame('is within the last … days', Labels::operatorLabelText('is within the last {value} days'));
    assertSame('is set', Labels::operatorLabelText('is set'));
});

/* ------------------------------------------------------------------ *
 * Shared validateDocument() fixtures
 * ------------------------------------------------------------------ */

fwrite(STDOUT, "\nShared validate fixtures\n");

foreach ($fixtures['validateCases'] as $case) {
    check($case['name'], static function () use ($case): void {
        // The whole problem, not just the message: the code and params are
        // what a translated message is built from, so they are the contract.
        // Compared as JSON so an empty params map reads the same in both.
        $problems = Evaluator::validateDocument($case['document'], $case['options'] ?? []);
        $norm = static fn (array $list): string => (string) json_encode(array_map(
            static fn (array $p): array => ['path' => $p['path'], 'code' => $p['code'], 'params' => (object) $p['params'], 'message' => $p['message']],
            $list
        ), JSON_UNESCAPED_UNICODE);
        assertSame($norm($case['expected']), $norm($problems), 'problems');
    });
}

fwrite(STDOUT, sprintf("\n%d passed, %d failed\n", $passed, $failed));

exit($failed === 0 ? 0 : 1);
