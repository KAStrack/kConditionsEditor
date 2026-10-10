<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Tests;

use Kastrack\ConditionsEditor\Evaluator;
use Kastrack\ConditionsEditor\Exception\ConditionException;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Runs the shared cross-language fixtures against the PHP SDK.
 *
 * The JavaScript suite runs the very same file, so the two runtimes cannot
 * drift apart without a test going red.
 */
final class ConformanceTest extends TestCase
{
    /** @return array<string, array{array<string, mixed>}> */
    public static function caseProvider(): array
    {
        $path = __DIR__ . '/../../../tests/fixtures/cases.json';
        $fixtures = json_decode((string) file_get_contents($path), true);

        $out = [];
        foreach ($fixtures['cases'] as $case) {
            $out[$case['name']] = [$case];
        }

        return $out;
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('caseProvider')]
    public function testCase(array $case): void
    {
        $evaluator = new Evaluator($case['options'] ?? []);

        if (!empty($case['expectThrows'])) {
            $this->expectException(ConditionException::class);
            $evaluator->evaluateDetailed($case['document'], $case['data'] ?? []);

            return;
        }

        $details = $evaluator->evaluateDetailed($case['document'], $case['data'] ?? []);

        self::assertSame($case['expected'], $details->result, 'boolean result');

        if (isset($case['expectSkipped'])) {
            $names = array_column($details->skipped, 'operator');
            foreach ($case['expectSkipped'] as $expected) {
                self::assertContains($expected, $names, 'expected among skipped');
            }
        }

        if (isset($case['expectErrorHandled'])) {
            $names = array_column($details->errors, 'operator');
            foreach ($case['expectErrorHandled'] as $expected) {
                self::assertContains($expected, $names, 'expected among handled errors');
            }
        }
    }
}
