<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor\Support;

use DateTimeInterface;

/**
 * Blank values: `countAsBlank`.
 *
 * A field definition may name stored values that count as blank besides NULL
 * and '', which always do: a preset (`'json'`, the spellings of empty
 * JsonStorage::EMPTY_FORMS lists) or a list of exact strings (`['N/A', '-']`).
 * It changes what is_empty / is_not_empty mean, and is_set / is_not_set with
 * them, for the reason JSON storage gives: "set" on a column that clears to
 * `[]` on one save path and NULL on another asks nothing a person means, and
 * "is not set" must not keep the `[]` rows. Every other operator reads the
 * stored value as before.
 *
 * A string is always a preset name and a list always holds values, so the
 * value "json" is written ['json']. An unknown preset is ignored, as an unknown
 * storage is. Values are compared exactly — case, spaces and all — because the
 * SQL compares bytes; a value that arrives already decoded is compared by its
 * text, and under 'json' a list that is an empty list by the JSON rule is
 * blank too, as it is with storage 'json'. This mirrors the JavaScript SDK's
 * blankSet() / isBlank(), and the shared fixtures hold the two together.
 */
final class CountAsBlank
{
    /** The builtins countAsBlank decides, and whether each one asks "is blank". */
    public const OPERATORS = ['is_empty' => true, 'is_not_set' => true, 'is_not_empty' => false, 'is_set' => false];

    /** @var array<string, array<int, string>> */
    private const PRESETS = ['json' => JsonStorage::EMPTY_FORMS];

    /**
     * `['forms' => …, 'json' => …]` for a field that declares countAsBlank,
     * otherwise null. `forms` is every stored text that counts as blank, ''
     * first; `json` says the 'json' preset was named.
     *
     * @return array{forms: array<int, string>, json: bool}|null
     */
    public static function set(mixed $field): ?array
    {
        $c = is_array($field) ? ($field['countAsBlank'] ?? null) : null;
        if (is_string($c)) {
            $p = strtolower($c);

            return isset(self::PRESETS[$p]) ? ['forms' => self::PRESETS[$p], 'json' => $p === 'json'] : null;
        }
        if (!is_array($c)) {
            return null;
        }
        $forms = [''];
        foreach ($c as $s) {
            if (is_string($s) && !in_array($s, $forms, true)) {
                $forms[] = $s;
            }
        }

        // Nothing beyond '' is the default, so it is no option at all.
        return count($forms) > 1 ? ['forms' => $forms, 'json' => false] : null;
    }

    /**
     * A map of field name to blank set, for the fields that declare one.
     *
     * @return array<string, array{forms: array<int, string>, json: bool}>
     */
    public static function map(mixed $fields): array
    {
        $out = [];
        foreach (is_array($fields) ? $fields : [] as $f) {
            $s = self::set($f);
            if ($s !== null && is_array($f) && isset($f['name'])) {
                $out[(string) $f['name']] = $s;
            }
        }

        return $out;
    }

    /**
     * Whether a stored value counts as blank under a blank set.
     *
     * @param array{forms: array<int, string>, json: bool} $set
     */
    public static function isBlank(mixed $v, array $set): bool
    {
        if (Values::isEmptyValue($v)) {
            return true;
        }
        if (!is_string($v)) {
            if ($set['json'] && is_array($v) && array_is_list($v) && JsonStorage::read($v)['empty']) {
                return true;
            }
            $v = self::text($v);
        }

        return in_array($v, $set['forms'], true);
    }

    /** A decoded value's text, written as the JavaScript SDK writes it (JSON.stringify for a list or an object). */
    private static function text(mixed $v): string
    {
        if (is_array($v) || (is_object($v) && !$v instanceof DateTimeInterface)) {
            return (string) json_encode($v, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES
                | JSON_UNESCAPED_LINE_TERMINATORS | JSON_INVALID_UTF8_SUBSTITUTE);
        }

        return Values::asString($v);
    }
}
