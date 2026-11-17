<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Support;

/**
 * Field storage: `storage => 'json'`.
 *
 * A field definition may say how its value is stored. `'json'` is a list kept
 * as JSON array text — `["3184","3152"]`, `[]` for none — the shape a
 * multi-select usually takes in a text column. The evaluator and the SQL
 * builder both read the option through storage() and the value through read(),
 * so they cannot disagree about what the field holds. This mirrors the
 * JavaScript SDK's fieldStorage() / readJsonList(), and the shared fixtures in
 * tests/fixtures/cases.json hold the two to the same answers.
 *
 * Empty has many spellings, because save paths differ: NULL, '', `[]`, `null`,
 * `[""]`, `["[]"]`, `[null]`, and `"[]"`, `""`, `"[\"\"]"` (the same saved
 * twice). All of them are empty. A twice-saved value is decoded a second time
 * only to see whether it is empty; its contents are not read from it, because
 * no SQL dialect can decode twice and a rule must pick the same rows in SQL as
 * in an evaluator. Text that is not JSON at all is something (not empty) that
 * names nothing (includes no value), which is what the SQL says about it.
 */
final class JsonStorage
{
    /**
     * The spellings of empty a SQL translation lists. read() reads every one
     * of them as empty, and a few no save path is known to write (`[ ]`,
     * `["", ""]`) besides.
     */
    public const EMPTY_FORMS = ['', '[]', '["[]"]', '[""]', '[null]', 'null', '"[]"', '""', '"[\"\"]"'];

    /** The builtin operators whose meaning the storage decides. */
    public const OPERATORS = ['is_set', 'is_not_set', 'is_empty', 'is_not_empty', 'includes_any', 'includes_all'];

    /** Sentinel for text that is not JSON. */
    private const NOT_JSON = "\0kConditionsNotJson\0";

    /** 'json' when a field definition declares JSON storage, otherwise null. */
    public static function storage(mixed $field): ?string
    {
        $s = is_array($field) ? ($field['storage'] ?? null) : null;

        return is_string($s) && strtolower($s) === 'json' ? 'json' : null;
    }

    /**
     * A map of field name to storage, for the fields that declare one.
     *
     * @return array<string, string>
     */
    public static function map(mixed $fields): array
    {
        $out = [];
        foreach (is_array($fields) ? $fields : [] as $f) {
            $s = self::storage($f);
            if ($s !== null && is_array($f) && isset($f['name'])) {
                $out[(string) $f['name']] = $s;
            }
        }

        return $out;
    }

    private static function parse(string $s): mixed
    {
        try {
            return json_decode($s, false, 512, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            return self::NOT_JSON;
        }
    }

    private static function isList(mixed $v): bool
    {
        return is_array($v) && array_is_list($v);
    }

    /** An element is empty when it is null or '', or a string or a list that is itself an empty list. */
    private static function emptyElement(mixed $e): bool
    {
        if ($e === null || $e === '') {
            return true;
        }
        if (is_string($e)) {
            $d = self::parse($e);

            return self::isList($d) && self::emptyArray($d);
        }

        return self::isList($e) && self::emptyArray($e);
    }

    /** @param array<int, mixed> $a */
    private static function emptyArray(array $a): bool
    {
        foreach ($a as $e) {
            if (!self::emptyElement($e)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Read a JSON-stored list.
     *
     * `empty` is whether it holds nothing; `items` the string elements a list
     * operator matches against; `value` the decoded value, which is what any
     * other operator (or a registered callback) is handed. Accepts the stored
     * text or a value already decoded (a list).
     *
     * @return array{empty: bool, items: array<int, string>, value: mixed}
     */
    public static function read(mixed $raw): array
    {
        if (Values::isNullish($raw) || $raw === '') {
            return ['empty' => true, 'items' => [], 'value' => null];
        }
        $v = $raw;
        if (is_string($raw)) {
            $v = self::parse($raw);
            if ($v === self::NOT_JSON) {
                return ['empty' => false, 'items' => [], 'value' => $raw];
            }
        }
        if ($v === null || $v === '') {
            return ['empty' => true, 'items' => [], 'value' => null];
        }
        // A bare string is a list of one — JSON_CONTAINS('"3184"', '"3184"') is
        // true — unless it is an empty list saved twice: "[]", "[\"\"]".
        if (is_string($v)) {
            return self::emptyElement($v)
                ? ['empty' => true, 'items' => [], 'value' => $v]
                : ['empty' => false, 'items' => [$v], 'value' => $v];
        }
        if (!self::isList($v)) {
            return ['empty' => false, 'items' => [], 'value' => $v];
        }
        $items = [];
        $held = false;
        foreach ($v as $e) {
            if (self::emptyElement($e)) {
                continue;
            }
            $held = true;
            if (is_string($e)) {
                $items[] = $e;
            }
        }

        return ['empty' => !$held, 'items' => $items, 'value' => $v];
    }

    /**
     * The operands of a list operator on a JSON-stored field, read once for the
     * evaluator and the SQL alike. One that is itself a spelling of empty ('' or
     * "[]") is dropped: an empty element is never one of the list's items, so
     * it could only ever match in SQL.
     *
     * @return array<int, mixed>
     */
    public static function operands(mixed $arg): array
    {
        return array_values(array_filter(
            Values::toList($arg),
            static fn ($w): bool => !Values::isNullish($w) && !self::emptyElement(Values::asString($w))
        ));
    }

    /**
     * What a builtin list or existence operator means on a JSON-stored field.
     *
     * An element is a string, compared as a string: `3184` stored as a number
     * is not the choice "3184", as JSON_CONTAINS says too. `is set` / `is not
     * set` are `is not empty` / `is empty`: a list column clears to `[]` on one
     * save path and to NULL on another, so "set but empty" is nothing a person
     * could ask about — and "is not set" must not miss the `[]` rows.
     *
     * @param array{empty: bool, items: array<int, string>, value: mixed} $stored
     * @param array<int, mixed> $args
     */
    public static function evaluate(string $operator, array $stored, array $args, bool $caseInsensitive): bool
    {
        $holds = static function (mixed $want) use ($stored, $caseInsensitive): bool {
            $w = Values::fold(Values::asString($want), $caseInsensitive);
            foreach ($stored['items'] as $item) {
                if (Values::fold($item, $caseInsensitive) === $w) {
                    return true;
                }
            }

            return false;
        };

        switch ($operator) {
            case 'is_set':
            case 'is_not_empty':
                return !$stored['empty'];
            case 'is_not_set':
            case 'is_empty':
                return $stored['empty'];
            case 'includes_any':
                foreach (self::operands($args[0] ?? null) as $want) {
                    if ($holds($want)) {
                        return true;
                    }
                }

                return false;
            case 'includes_all':
                $wants = self::operands($args[0] ?? null);
                if ($wants === []) {
                    return false;
                }
                foreach ($wants as $want) {
                    if (!$holds($want)) {
                        return false;
                    }
                }

                return true;
        }

        throw new \LogicException(sprintf('"%s" is not a JSON-storage operator', $operator));
    }
}
