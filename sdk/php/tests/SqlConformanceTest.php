<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Tests;

use Kastrack\ConditionsEditor\Exception\ConditionException;
use Kastrack\ConditionsEditor\SqlBuilder;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

/**
 * Runs the shared SQL fixtures against the PHP builder. The JavaScript suite
 * runs the same file, so the two must agree character for character.
 */
final class SqlConformanceTest extends TestCase
{
    /** @return array<string, array{array<string, mixed>}> */
    public static function caseProvider(): array
    {
        $path = __DIR__ . '/../../../tests/fixtures/cases.json';
        $fixtures = json_decode((string) file_get_contents($path), true);

        $out = [];
        foreach ($fixtures['sqlCases'] as $case) {
            $out[$case['name']] = [$case];
        }

        return $out;
    }

    /** @param array<string, mixed> $case */
    #[DataProvider('caseProvider')]
    public function testCase(array $case): void
    {
        $options = $case['options'] ?? [];

        if (!empty($case['expectThrows'])) {
            $this->expectException(ConditionException::class);
            (new SqlBuilder($options))->build($case['document']);

            return;
        }

        $out = (new SqlBuilder($options))->build($case['document']);

        self::assertSame($case['expectedSql'], $out['sql'], 'generated SQL');

        if (isset($case['expectedParams'])) {
            self::assertSame($case['expectedParams'], $out['params'], 'bound parameters');
        }

        foreach (($case['expectSkipped'] ?? []) as $expected) {
            self::assertContains($expected, array_column($out['skipped'], 'operator'));
        }
    }
}
