<?php

declare(strict_types=1);

namespace Kastrack\ConditionsEditor;

use Kastrack\ConditionsEditor\Exception\ConditionException;
use Kastrack\ConditionsEditor\Exception\NoSqlTranslationException;
use Kastrack\ConditionsEditor\Exception\UnsupportedInSqlException;
use Kastrack\ConditionsEditor\Support\Policy;
use Kastrack\ConditionsEditor\Support\Values;

/**
 * Translates a kConditions document into a self-contained SQL boolean
 * expression — the part that goes after WHERE in a SELECT.
 *
 * This is the server-side path: the browser posts the document and the SQL is
 * built here, which is right when your endpoint receives a rule. The editor can
 * also write SQL client-side into a field that already accepted SQL, where the
 * trust boundary has not moved. Prefer `parameters => true` where your driver
 * supports placeholders.
 *
 * Behaviour mirrors src/k-conditions-sql.js exactly; the shared fixtures in
 * tests/fixtures/cases.json enforce it.
 */
final class SqlBuilder
{
    public const VERSION = '0.1.2';

    private const DAY_MS = 86400000;

    /** @var array<string, array<string, mixed>> */
    private const DIALECTS = [
        'standard' => ['open' => '"', 'close' => '"', 'backslash' => false, 'bool' => ['TRUE', 'FALSE'], 'regex' => null, 'placeholder' => 'question'],
        'mysql' => ['open' => '`', 'close' => '`', 'backslash' => true, 'bool' => ['1', '0'], 'regex' => ['REGEXP', 'NOT REGEXP'], 'placeholder' => 'question'],
        'postgres' => ['open' => '"', 'close' => '"', 'backslash' => false, 'bool' => ['TRUE', 'FALSE'], 'regex' => ['~', '!~'], 'placeholder' => 'numbered'],
        'sqlite' => ['open' => '"', 'close' => '"', 'backslash' => false, 'bool' => ['1', '0'], 'regex' => ['REGEXP', 'NOT REGEXP'], 'placeholder' => 'question', 'regexNote' => 'SQLite has no built-in REGEXP; register a REGEXP function on the connection.'],
        'sqlserver' => ['open' => '[', 'close' => ']', 'backslash' => false, 'bool' => ['1', '0'], 'regex' => null, 'placeholder' => 'named'],
    ];

    private const ALIASES = [
        'mariadb' => 'mysql', 'postgresql' => 'postgres', 'mssql' => 'sqlserver', 'ansi' => 'standard',
    ];

    /** @var array<string, mixed> */
    private const DEFAULTS = [
        'dialect' => 'standard',
        'fields' => null,
        'columns' => null,
        'parameters' => false,
        'placeholderStyle' => null,
        'quoteIdentifiers' => true,
        'nullSafeNegation' => true,
        'emptyResult' => true,
        'now' => null,
        'pretty' => false,
        'unresolvedPolicy' => Policy::ERROR,
        'errorPolicy' => Policy::ERROR,
        'unsupportedPolicy' => Policy::ERROR,
        'environment' => null,
        'profiles' => [],
        'operators' => null,
    ];

    /** Sentinel for a node that drops out of the expression. */
    private const SKIP = "\0kcSkip\0";

    /** @var array<string, mixed> */
    private array $o;

    /** @var array<string, mixed> */
    private array $d;

    private string $dialectName;

    /** @var array<string, string> */
    private array $columnFor = [];

    /** @var array<string, string> */
    private array $typeFor = [];

    /** @var array<int, mixed> */
    private array $params = [];

    /** @var array<int, array<string, mixed>> */
    private array $warnings = [];

    /** @var array<int, array<string, mixed>> */
    private array $skipped = [];

    /** @var array<string, mixed> */
    private array $doc = [];

    /** @param array<string, mixed> $options */
    public function __construct(array $options = [])
    {
        $this->o = array_merge(self::DEFAULTS, $options);

        $name = strtolower((string) ($this->o['dialect'] ?? 'standard'));
        $name = self::ALIASES[$name] ?? $name;
        if (!isset(self::DIALECTS[$name])) {
            $this->warnings[] = ['reason' => 'dialect', 'message' => sprintf('Unknown dialect "%s"; using standard SQL.', (string) $this->o['dialect'])];
            $name = 'standard';
        }
        $this->dialectName = $name;
        $this->d = self::DIALECTS[$name];

        foreach ((array) ($this->o['fields'] ?? []) as $f) {
            if (is_string($f)) {
                $this->columnFor[$f] = $f;

                continue;
            }
            if (!is_array($f) || !isset($f['name'])) {
                continue;
            }
            $this->columnFor[$f['name']] = (string) ($f['column'] ?? $f['sql'] ?? $f['name']);
            if (isset($f['type'])) {
                $this->typeFor[$f['name']] = (string) $f['type'];
            }
        }
        foreach ((array) ($this->o['columns'] ?? []) as $k => $v) {
            $this->columnFor[(string) $k] = (string) $v;
        }
    }

    /**
     * @param array<string, mixed>|string|null $document
     * @return array{sql: string, params: array<int, mixed>, dialect: string, skipped: array<int, array<string, mixed>>, warnings: array<int, array<string, mixed>>}
     */
    public function build(array|string|null $document): array
    {
        $this->doc = Evaluator::normaliseDocument($document);
        $sql = $this->node($this->doc['root'], 'root', 0);
        if ($sql === self::SKIP) {
            $sql = $this->o['emptyResult'] ? '1 = 1' : '1 = 0';
        }

        return [
            'sql' => $sql,
            'params' => $this->params,
            'dialect' => $this->dialectName,
            'skipped' => $this->skipped,
            'warnings' => $this->warnings,
        ];
    }

    /* ------------------------------------------------------------------ *
     * Lexical bits
     * ------------------------------------------------------------------ */

    private function escapeString(string $s): string
    {
        if ($this->d['backslash']) {
            $s = str_replace('\\', '\\\\', $s);
        }

        return str_replace("'", "''", $s);
    }

    public function ident(string $name): string
    {
        if (!$this->o['quoteIdentifiers']) {
            return $name;
        }
        $open = (string) $this->d['open'];
        $close = (string) $this->d['close'];

        return implode('.', array_map(
            static fn (string $part): string => $open . str_replace($close, $close . $close, $part) . $close,
            explode('.', $name)
        ));
    }

    private function column(string $field): string
    {
        return $this->ident($this->columnFor[$field] ?? $field);
    }

    private function placeholder(mixed $value): string
    {
        $this->params[] = $value;
        $style = $this->o['placeholderStyle'] ?? $this->d['placeholder'];
        if ($style === 'numbered') {
            return '$' . count($this->params);
        }
        if ($style === 'named') {
            return '@p' . count($this->params);
        }

        return '?';
    }

    private function literal(mixed $value, ?string $hint = null): string
    {
        if ($value === null) {
            return 'NULL';
        }
        if ($this->o['parameters']) {
            return $this->placeholder($value);
        }
        if (is_bool($value)) {
            return $value ? $this->d['bool'][0] : $this->d['bool'][1];
        }
        if (is_int($value) || is_float($value)) {
            if (!is_finite((float) $value)) {
                throw new ConditionException('Cannot render a non-finite number in SQL');
            }

            return Values::numberToString((float) $value);
        }
        if ($hint === 'number') {
            $n = Values::toNumber($value);
            if ($n !== null) {
                return Values::numberToString($n);
            }
        }

        return "'" . $this->escapeString(Values::asString($value)) . "'";
    }

    private function formatDate(float $ms, string $field): string
    {
        $seconds = (int) floor($ms / 1000);
        $date = gmdate('Y-m-d', $seconds);
        $midnight = gmdate('H:i:s', $seconds) === '00:00:00' && fmod($ms, 1000.0) === 0.0;
        $type = $this->typeFor[$field] ?? null;
        if ($midnight && ($type === 'date' || $type === null)) {
            return $date;
        }

        return $date . ' ' . gmdate('H:i:s', $seconds);
    }

    private function dateLiteral(mixed $value, string $field): string
    {
        $ms = Values::toDate($value);
        if ($ms === null) {
            throw new ConditionException('Value is not a date: ' . Values::asString($value));
        }

        return $this->literal($this->formatDate($ms, $field));
    }

    private function likePattern(mixed $value, string $mode): string
    {
        $raw = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], Values::asString($value));

        return match ($mode) {
            'contains' => '%' . $raw . '%',
            'starts' => $raw . '%',
            'ends' => '%' . $raw,
            default => $raw,
        };
    }

    private function escapeClause(): string
    {
        return " ESCAPE '" . $this->escapeString('\\') . "'";
    }

    private function nowMs(): float
    {
        $n = $this->o['now'] ?? null;
        if (is_callable($n)) {
            $n = $n();
        }
        if ($n instanceof \DateTimeInterface) {
            return (float) $n->getTimestamp() * 1000;
        }
        if (is_int($n) || is_float($n)) {
            return (float) $n;
        }
        if (is_string($n) && $n !== '') {
            $d = Values::toDate($n);
            if ($d !== null) {
                return $d;
            }
        }

        return floor(microtime(true) * 1000);
    }

    /** @return array<int, string> */
    private function labels(): array
    {
        $out = [];
        foreach ((array) ($this->o['profiles'] ?? []) as $p) {
            if ($p !== null && $p !== '') {
                $out[] = (string) $p;
            }
        }
        if (!empty($this->o['environment'])) {
            $out[] = (string) $this->o['environment'];
        }
        $out[] = $this->dialectName;
        $out[] = 'sql';

        return $out;
    }

    /* ------------------------------------------------------------------ *
     * Walking
     * ------------------------------------------------------------------ */

    private function node(mixed $node, string $path, int $depth): string
    {
        if (!is_array($node)) {
            return self::SKIP;
        }
        $type = $node['type'] ?? null;
        if ($type === 'group') {
            return $this->group($node, $path, $depth);
        }
        if ($type === 'condition') {
            return $this->condition($node, $path);
        }

        throw new ConditionException(sprintf('Unknown node type "%s" at %s', (string) $type, $path));
    }

    /** @param array<string, mixed> $node */
    private function group(array $node, string $path, int $depth): string
    {
        $children = is_array($node['children'] ?? null) ? $node['children'] : [];
        $joiner = ($node['operator'] ?? 'and') === 'or' ? 'OR' : 'AND';
        $parts = [];

        foreach ($children as $i => $child) {
            $sql = $this->node($child, $path . '.children[' . $i . ']', $depth + 1);
            if ($sql === self::SKIP) {
                continue;
            }
            $parts[] = $sql;
        }

        if (!$parts) {
            return self::SKIP;
        }

        if ($this->o['pretty'] && count($parts) > 1) {
            $pad = str_repeat('    ', $depth + 1);
            $joined = implode("\n" . $pad . $joiner . ' ', $parts);
        } else {
            $joined = implode(' ' . $joiner . ' ', $parts);
        }

        $wrapped = count($parts) > 1 ? '(' . $joined . ')' : $joined;

        if (!empty($node['negate'])) {
            return 'NOT ' . (count($parts) > 1 ? $wrapped : '(' . $wrapped . ')');
        }

        return $wrapped;
    }

    /** @param array<string, mixed> $node */
    private function condition(array $node, string $path): string
    {
        $name = (string) ($node['operator'] ?? '');
        $manifest = $this->doc['operators'][$name] ?? ($this->o['operators'][$name] ?? null);
        if (!is_array($manifest)) {
            $manifest = null;
        }

        try {
            $sql = $this->operator($node, $manifest, $path);
        } catch (UnsupportedInSqlException $e) {
            return $this->applyPolicy($this->policyFor('unsupported', $node, $manifest), 'unsupported', $node, $path, $e->getMessage());
        } catch (NoSqlTranslationException $e) {
            return $this->applyPolicy($this->policyFor('unresolved', $node, $manifest), 'unresolved', $node, $path, $e->getMessage());
        }

        if ($sql === self::SKIP) {
            return self::SKIP;
        }

        return !empty($node['negate']) ? 'NOT (' . $sql . ')' : $sql;
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed>|null $manifest
     */
    private function policyFor(string $kind, array $node, ?array $manifest): string
    {
        $labels = $this->labels();
        $chosen = null;
        if (isset($node['policy'][$kind])) {
            $chosen = Policy::resolve($node['policy'][$kind], $labels);
        }
        if ($chosen === null && isset($manifest['policy'][$kind])) {
            $chosen = Policy::resolve($manifest['policy'][$kind], $labels);
        }
        if ($chosen === null) {
            $fallback = match ($kind) {
                'unresolved' => $this->o['unresolvedPolicy'],
                'unsupported' => $this->o['unsupportedPolicy'],
                default => $this->o['errorPolicy'],
            };
            $chosen = Policy::resolve($fallback, $labels);
        }

        return $chosen ?? Policy::ERROR;
    }

    /** @param array<string, mixed> $node */
    private function applyPolicy(string $policy, string $reason, array $node, string $path, string $message): string
    {
        if ($policy === Policy::SKIP) {
            $this->skipped[] = ['path' => $path, 'field' => $node['field'] ?? null, 'operator' => $node['operator'] ?? null, 'reason' => $reason];

            return self::SKIP;
        }
        if ($policy === Policy::TRUE || $policy === Policy::FALSE) {
            $this->warnings[] = ['path' => $path, 'operator' => $node['operator'] ?? null, 'reason' => $reason, 'handled' => $policy, 'message' => $message];

            return $policy === Policy::TRUE ? '1 = 1' : '1 = 0';
        }

        throw new ConditionException(sprintf(
            'Operator "%s" at %s cannot be expressed in %s SQL: %s',
            (string) ($node['operator'] ?? ''),
            $path,
            $this->dialectName,
            $message
        ), ['path' => $path, 'operator' => $node['operator'] ?? null, 'reason' => $reason]);
    }

    /** @param array<string, mixed> $v */
    private function operand(mixed $v, ?string $hint, string $field): string
    {
        if (!is_array($v)) {
            return $this->literal($v, $hint);
        }
        if (($v['source'] ?? null) === 'field') {
            return $this->column((string) ($v['field'] ?? ''));
        }
        if ($hint === 'date') {
            return $this->dateLiteral($v['value'] ?? null, $field);
        }

        return $this->literal($v['value'] ?? null, $hint);
    }

    /**
     * @param array<string, mixed> $node
     * @param array<string, mixed>|null $manifest
     */
    private function operator(array $node, ?array $manifest, string $path): string
    {
        $field = (string) ($node['field'] ?? '');
        $col = $this->column($field);
        $values = is_array($node['values'] ?? null) ? $node['values'] : [];
        $op = (string) ($node['operator'] ?? '');
        $nullSafe = (bool) $this->o['nullSafeNegation'];

        $v = fn (int $i, ?string $hint = null): string => $this->operand($values[$i] ?? null, $hint, $field);
        $orNull = static fn (string $expr): string => $nullSafe ? '(' . $col . ' IS NULL OR ' . $expr . ')' : $expr;

        $like = function (string $mode, bool $negated) use ($values, $col, $orNull): string {
            if (($values[0]['source'] ?? null) === 'field') {
                throw new UnsupportedInSqlException('LIKE against another column is not generated; use a raw SQL operator template');
            }
            $pattern = $this->likePattern($values[0]['value'] ?? null, $mode);
            $expr = $col . ($negated ? ' NOT LIKE ' : ' LIKE ') . $this->literal($pattern) . $this->escapeClause();

            return $negated ? $orNull($expr) : $expr;
        };

        $inList = function (bool $negated) use ($values, $col, $orNull): string {
            $raw = ($values[0]['source'] ?? null) === 'field' ? null : ($values[0]['value'] ?? null);
            $list = Values::toList($raw);
            if (!$list) {
                return $negated ? '1 = 1' : '1 = 0';
            }
            $rendered = implode(', ', array_map(fn ($x) => $this->literal($x), $list));
            $expr = $col . ($negated ? ' NOT IN (' : ' IN (') . $rendered . ')';

            return $negated ? $orNull($expr) : $expr;
        };

        $dayRange = fn (float $ms): string => '(' . $col . ' >= ' . $this->literal($this->formatDate($ms, $field))
            . ' AND ' . $col . ' < ' . $this->literal($this->formatDate($ms + self::DAY_MS, $field)) . ')';

        /* --- custom operators ------------------------------------------- */

        if ($manifest !== null) {
            if (!empty($manifest['sql'])) {
                return $this->template((string) $manifest['sql'], $node, $col);
            }
            if (($manifest['kind'] ?? null) === 'values') {
                $list = self::choiceValues($manifest['values'] ?? null);
                $arity = $manifest['arity'] ?? 0;
                if ($arity !== 0 && $values) {
                    $list = Values::toList($values[0]['value'] ?? null);
                }
                if (!$list) {
                    return ($manifest['match'] ?? 'in') === 'not_in' ? '1 = 1' : '1 = 0';
                }
                $rendered = implode(', ', array_map(fn ($x) => $this->literal($x), $list));
                $negated = ($manifest['match'] ?? 'in') === 'not_in';
                $expr = $col . ($negated ? ' NOT IN (' : ' IN (') . $rendered . ')';

                return $negated ? $orNull($expr) : $expr;
            }
            if (($manifest['kind'] ?? null) === 'callback') {
                throw new NoSqlTranslationException('callback operators have no SQL equivalent; give the operator an "sql" template');
            }
        } elseif (!Operators::has($op)) {
            throw new NoSqlTranslationException('unknown operator');
        }

        /* --- builtins ---------------------------------------------------- */

        switch ($op) {
            case 'eq': return $col . ' = ' . $v(0);
            case 'neq': return $orNull($col . ' <> ' . $v(0));

            case 'lt': return $col . ' < ' . $v(0, 'number');
            case 'lte': return $col . ' <= ' . $v(0, 'number');
            case 'gt': return $col . ' > ' . $v(0, 'number');
            case 'gte': return $col . ' >= ' . $v(0, 'number');
            case 'between': return $col . ' BETWEEN ' . $v(0, 'number') . ' AND ' . $v(1, 'number');
            case 'not_between': return $orNull($col . ' NOT BETWEEN ' . $v(0, 'number') . ' AND ' . $v(1, 'number'));

            case 'contains': return $like('contains', false);
            case 'not_contains': return $like('contains', true);
            case 'starts_with': return $like('starts', false);
            case 'ends_with': return $like('ends', false);

            case 'regex':
            case 'not_regex':
                if ($this->d['regex'] === null) {
                    throw new UnsupportedInSqlException($this->dialectName . ' has no regular expression operator');
                }
                if (isset($this->d['regexNote'])) {
                    $this->warnings[] = ['path' => $path, 'operator' => $op, 'message' => $this->d['regexNote']];
                }
                $rexpr = $col . ' ' . $this->d['regex'][$op === 'regex' ? 0 : 1] . ' ' . $v(0);

                return $op === 'regex' ? $rexpr : $orNull($rexpr);

            case 'in_list': return $inList(false);
            case 'not_in_list': return $inList(true);

            case 'includes_any':
            case 'includes_all':
                // No portable storage shape for a multi-valued column — see the JS twin.
                throw new NoSqlTranslationException(sprintf(
                    'operator "%s" has no SQL translation: a multi-valued column has no portable shape; use a custom operator with an "sql" template',
                    $op
                ));

            case 'date_eq':
                $ms = Values::toDate($values[0]['value'] ?? null);
                if ($ms === null) {
                    throw new UnsupportedInSqlException('date_eq needs a literal date');
                }

                return $dayRange($ms);

            case 'date_before': return $col . ' < ' . $v(0, 'date');
            case 'date_after': return $col . ' > ' . $v(0, 'date');
            case 'date_between': return '(' . $col . ' >= ' . $v(0, 'date') . ' AND ' . $col . ' <= ' . $v(1, 'date') . ')';
            case 'date_is_today': return $dayRange(Values::startOfUtcDay($this->nowMs()));

            case 'date_within_last_days':
                $n = Values::toNumber($values[0]['value'] ?? null);
                if ($n === null) {
                    throw new UnsupportedInSqlException('date_within_last_days needs a number');
                }
                $now = $this->nowMs();

                return '(' . $col . ' >= ' . $this->literal($this->formatDate($now - $n * self::DAY_MS, $field))
                    . ' AND ' . $col . ' <= ' . $this->literal($this->formatDate($now, $field)) . ')';

            case 'date_within_next_days':
                $n = Values::toNumber($values[0]['value'] ?? null);
                if ($n === null) {
                    throw new UnsupportedInSqlException('date_within_next_days needs a number');
                }
                $now = $this->nowMs();

                return '(' . $col . ' >= ' . $this->literal($this->formatDate($now, $field))
                    . ' AND ' . $col . ' <= ' . $this->literal($this->formatDate($now + $n * self::DAY_MS, $field)) . ')';

            case 'date_more_than_days_ago':
                $n = Values::toNumber($values[0]['value'] ?? null);
                if ($n === null) {
                    throw new UnsupportedInSqlException('date_more_than_days_ago needs a number');
                }

                return $col . ' < ' . $this->literal($this->formatDate($this->nowMs() - $n * self::DAY_MS, $field));

            case 'date_more_than_days_ahead':
                $n = Values::toNumber($values[0]['value'] ?? null);
                if ($n === null) {
                    throw new UnsupportedInSqlException('date_more_than_days_ahead needs a number');
                }

                return $col . ' > ' . $this->literal($this->formatDate($this->nowMs() + $n * self::DAY_MS, $field));

            case 'is_true': return $col . ' = ' . $this->d['bool'][0];
            case 'is_false': return $col . ' = ' . $this->d['bool'][1];

            case 'is_set': return $col . ' IS NOT NULL';
            case 'is_not_set': return $col . ' IS NULL';
            case 'is_empty': return '(' . $col . ' IS NULL OR ' . $col . " = '')";
            case 'is_not_empty': return '(' . $col . ' IS NOT NULL AND ' . $col . " <> '')";

            default:
                throw new NoSqlTranslationException(sprintf('operator "%s" has no SQL translation', $op));
        }
    }

    /**
     * Render a raw SQL template from an operator manifest, e.g.
     * "sql": "email_is_unique({field})". The template is trusted configuration
     * from your own operator definitions, not user input.
     *
     * @param array<string, mixed> $node
     */
    private function template(string $tpl, array $node, string $col): string
    {
        $values = is_array($node['values'] ?? null) ? $node['values'] : [];
        $field = (string) ($node['field'] ?? '');

        return (string) preg_replace_callback('/\{(field|values|\d+)\}/', function (array $m) use ($values, $col, $field): string {
            if ($m[1] === 'field') {
                return $col;
            }
            if ($m[1] === 'values') {
                $raw = Values::toList($values[0]['value'] ?? null);

                return implode(', ', array_map(fn ($x) => $this->literal($x), $raw));
            }
            $i = (int) $m[1];

            return array_key_exists($i, $values) ? $this->operand($values[$i], null, $field) : 'NULL';
        }, $tpl);
    }

    /**
     * Normalise a choice list to its bare values. Accepts a list of scalars, a
     * list of ['value' => …, 'label' => …] maps, or an associative array.
     *
     * @return array<int, mixed>
     */
    public static function choiceValues(mixed $input): array
    {
        if (!is_array($input)) {
            return [];
        }
        $out = [];
        $isList = array_is_list($input);
        foreach ($input as $key => $entry) {
            if (!$isList) {
                $out[] = $key;

                continue;
            }
            if (is_array($entry) && array_key_exists('value', $entry)) {
                $out[] = $entry['value'];

                continue;
            }
            $out[] = $entry;
        }

        return $out;
    }
}
