<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Tests;

use Kastrack\ConditionsEditor\EvaluationResult;
use Kastrack\ConditionsEditor\Evaluator;
use Kastrack\ConditionsEditor\Skip;
use PHPUnit\Framework\TestCase;

use function Kastrack\ConditionsEditor\evaluate;

final class EvaluatorTest extends TestCase
{
    /**
     * @param array<int, array<string, mixed>> $children
     * @param array<string, mixed> $operators
     * @return array<string, mixed>
     */
    private static function doc(array $children, array $operators = []): array
    {
        return [
            'version' => '1.0',
            'operators' => $operators,
            'root' => ['type' => 'group', 'operator' => 'and', 'children' => $children],
        ];
    }

    /**
     * @param array<int, array<string, mixed>> $values
     * @return array<string, mixed>
     */
    private static function cond(string $field, string $operator, array $values = []): array
    {
        return ['type' => 'condition', 'field' => $field, 'operator' => $operator, 'values' => $values];
    }

    /** @return array<string, mixed> */
    private static function lit(mixed $v): array
    {
        return ['source' => 'literal', 'value' => $v];
    }

    public function testRegisteredOperatorTakesPriorityOverManifest(): void
    {
        $doc = self::doc(
            [self::cond('email', 'email_is_unique')],
            ['email_is_unique' => ['kind' => 'callback', 'arity' => 0, 'policy' => ['unresolved' => 'skip']]]
        );

        $evaluator = (new Evaluator())->registerOperator(
            'email_is_unique',
            static fn (mixed $value): bool => $value === 'new@example.com'
        );

        self::assertTrue($evaluator->evaluate($doc, ['email' => 'new@example.com']));
        self::assertFalse($evaluator->evaluate($doc, ['email' => 'taken@example.com']));
    }

    public function testCallbackMayReturnSkipAtRuntime(): void
    {
        $doc = self::doc(
            [self::cond('state', 'eq', [self::lit('Texas')]), self::cond('email', 'maybe')],
            ['maybe' => ['kind' => 'callback', 'arity' => 0]]
        );

        $evaluator = (new Evaluator())->registerOperator('maybe', static fn () => Skip::instance());
        $details = $evaluator->evaluateDetailed($doc, ['state' => 'Texas', 'email' => 'x@y.z']);

        self::assertTrue($details->result);
        self::assertCount(1, $details->skipped);
        self::assertSame('callback-skip', $details->skipped[0]['reason']);
    }

    public function testThrowingCallbackFollowsErrorPolicy(): void
    {
        $doc = self::doc(
            [self::cond('email', 'boom')],
            ['boom' => ['kind' => 'callback', 'arity' => 0, 'policy' => ['error' => 'skip']]]
        );

        $evaluator = (new Evaluator())->registerOperator('boom', static function (): bool {
            throw new \RuntimeException('database is down');
        });

        $details = $evaluator->evaluateDetailed($doc, ['email' => 'x@y.z']);

        self::assertTrue($details->result, 'skipped, so the empty document result applies');
        self::assertSame('error', $details->skipped[0]['reason']);
    }

    public function testErrorPolicyFalseRecordsTheCause(): void
    {
        $doc = self::doc([self::cond('email', 'boom')], ['boom' => ['kind' => 'callback', 'arity' => 0]]);

        $evaluator = (new Evaluator(['errorPolicy' => 'false']))->registerOperator('boom', static function (): bool {
            throw new \RuntimeException('database is down');
        });

        $details = $evaluator->evaluateDetailed($doc, ['email' => 'x@y.z']);

        self::assertFalse($details->result);
        self::assertSame('database is down', $details->errors[0]['message']);
    }

    public function testManifestCallbacksAreRefusedUnlessAllowed(): void
    {
        $doc = self::doc(
            [self::cond('email', 'probe')],
            ['probe' => [
                'kind' => 'callback',
                'arity' => 0,
                'callbacks' => ['php' => ['class' => Fixtures\Probe::class, 'method' => 'yes', 'static' => true]],
                'policy' => ['unresolved' => 'skip'],
            ]]
        );

        self::assertCount(1, (new Evaluator())->evaluateDetailed($doc, [])->skipped, 'refused by default');
        self::assertTrue((new Evaluator(['allowManifestCallbacks' => true]))->evaluate($doc, []));
        self::assertCount(
            1,
            (new Evaluator(['allowManifestCallbacks' => true, 'callbackAllowList' => ['other']]))
                ->evaluateDetailed($doc, [])->skipped,
            'refused by allow list'
        );
    }

    public function testResultHookReplacesTheReturnValue(): void
    {
        $doc = self::doc([self::cond('state', 'eq', [self::lit('Texas')])]);
        $options = ['environment' => 'server'];

        $out = evaluate($doc, ['state' => 'Texas'], $options, function (
            array $document,
            array $data,
            array $opts,
            bool $result,
            EvaluationResult $details
        ) use ($doc, $options): array {
            self::assertSame($doc, $document);
            self::assertSame(['state' => 'Texas'], $data);
            self::assertSame($options, $opts);
            self::assertTrue($result);

            return ['ok' => $result, 'deferred' => count($details->skipped)];
        });

        self::assertSame(['ok' => true, 'deferred' => 0], $out);
    }

    public function testDescribeRendersTheWorkedExample(): void
    {
        $doc = [
            'version' => '1.0',
            'root' => ['type' => 'group', 'operator' => 'and', 'children' => [
                self::cond('name', 'regex', [self::lit('^ben')]),
                ['type' => 'group', 'operator' => 'or', 'children' => [
                    self::cond('dob', 'date_before', [self::lit('1980')]),
                    ['type' => 'group', 'operator' => 'and', 'children' => [
                        self::cond('dob', 'date_before', [self::lit('1982')]),
                        self::cond('state', 'in_list', [self::lit(['Florida', 'Texas'])]),
                    ]],
                ]],
            ]],
        ];

        $text = Evaluator::describe($doc, ['fields' => [
            ['name' => 'name', 'label' => 'Name'],
            ['name' => 'dob', 'label' => 'Date of Birth'],
            ['name' => 'state', 'label' => 'State'],
        ]]);

        self::assertSame(
            '([Name] matches regex "^ben" AND ([Date of Birth] is before "1980" OR ([Date of Birth] is before "1982" AND [State] is one of ["Florida", "Texas"])))',
            $text
        );
    }

    public function testValidateDocumentCatchesArityAndFieldProblems(): void
    {
        $doc = self::doc([
            self::cond('name', 'between', [self::lit(1)]),
            self::cond('nope', 'eq', [self::lit(1)]),
            self::cond('name', 'not_an_operator'),
        ]);

        $messages = array_column(Evaluator::validateDocument($doc, ['fields' => [['name' => 'name']]]), 'message');

        self::assertNotEmpty(array_filter($messages, static fn ($m) => str_contains($m, 'expects 2 value(s)')));
        self::assertNotEmpty(array_filter($messages, static fn ($m) => str_contains($m, 'Unknown field "nope"')));
        self::assertNotEmpty(array_filter($messages, static fn ($m) => str_contains($m, 'Unknown operator "not_an_operator"')));
    }

    public function testDocumentsMayBePassedAsJsonStringsOrBareNodes(): void
    {
        $doc = self::doc([self::cond('state', 'eq', [self::lit('Texas')])]);

        self::assertTrue(evaluate((string) json_encode($doc), ['state' => 'Texas']));
        self::assertTrue(evaluate($doc['root'], ['state' => 'Texas']));
        self::assertTrue(evaluate(self::cond('state', 'eq', [self::lit('Texas')]), ['state' => 'Texas']));
        self::assertTrue(evaluate('', []));
    }

    public function testTraceRecordsEveryEvaluatedNode(): void
    {
        $doc = self::doc([self::cond('state', 'eq', [self::lit('Texas')])]);
        $details = (new Evaluator(['trace' => true]))->evaluateDetailed($doc, ['state' => 'Texas']);

        self::assertNotNull($details->trace);
        self::assertCount(2, $details->trace);
        self::assertSame('condition', $details->trace[0]['type']);
        self::assertSame('group', $details->trace[1]['type']);
    }

    public function testEvaluatorAcceptsObjectData(): void
    {
        $doc = self::doc([self::cond('state', 'eq', [self::lit('Texas')])]);
        $data = (object) ['state' => 'Texas'];

        self::assertTrue((new Evaluator())->evaluate($doc, $data));
    }
}
