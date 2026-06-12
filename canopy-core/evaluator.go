package main

import (
	"strings"
	"unicode"
)

type TokenType int

const (
	TokenEOF TokenType = iota
	TokenAnd
	TokenOr
	TokenNot
	TokenLParen
	TokenRParen
	TokenTag
)

type Token struct {
	Type  TokenType
	Value string
}

type lexer struct {
	input []rune
	pos   int
}

func newLexer(input string) *lexer {
	return &lexer{input: []rune(input), pos: 0}
}

func (l *lexer) nextToken() Token {
	l.skipWhitespace()
	if l.pos >= len(l.input) {
		return Token{Type: TokenEOF}
	}

	ch := l.input[l.pos]

	if ch == '(' {
		l.pos++
		return Token{Type: TokenLParen, Value: "("}
	}
	if ch == ')' {
		l.pos++
		return Token{Type: TokenRParen, Value: ")"}
	}

	if ch == '"' || ch == '\'' {
		quote := ch
		l.pos++
		start := l.pos
		for l.pos < len(l.input) && l.input[l.pos] != quote {
			l.pos++
		}
		val := string(l.input[start:l.pos])
		if l.pos < len(l.input) {
			l.pos++ // consume closing quote
		}
		return Token{Type: TokenTag, Value: val}
	}

	// Unquoted literal
	start := l.pos
	for l.pos < len(l.input) && !unicode.IsSpace(l.input[l.pos]) && l.input[l.pos] != '(' && l.input[l.pos] != ')' {
		l.pos++
	}
	val := string(l.input[start:l.pos])
	upperVal := strings.ToUpper(val)

	if upperVal == "AND" {
		return Token{Type: TokenAnd, Value: val}
	} else if upperVal == "OR" {
		return Token{Type: TokenOr, Value: val}
	} else if upperVal == "NOT" {
		return Token{Type: TokenNot, Value: val}
	}

	return Token{Type: TokenTag, Value: val}
}

func (l *lexer) skipWhitespace() {
	for l.pos < len(l.input) && unicode.IsSpace(l.input[l.pos]) {
		l.pos++
	}
}

type parser struct {
	lexer *lexer
	cur   Token
}

func newParser(input string) *parser {
	p := &parser{lexer: newLexer(input)}
	p.cur = p.lexer.nextToken()
	return p
}

func (p *parser) advance() {
	p.cur = p.lexer.nextToken()
}

// AST Nodes
type Expr interface {
	Eval(tags map[string]bool) bool
}

type TagExpr struct {
	Tag string
}

func (e TagExpr) Eval(tags map[string]bool) bool {
	return tags[strings.ToLower(e.Tag)]
}

type NotExpr struct {
	Expr Expr
}

func (e NotExpr) Eval(tags map[string]bool) bool {
	return !e.Expr.Eval(tags)
}

type AndExpr struct {
	Left  Expr
	Right Expr
}

func (e AndExpr) Eval(tags map[string]bool) bool {
	return e.Left.Eval(tags) && e.Right.Eval(tags)
}

type OrExpr struct {
	Left  Expr
	Right Expr
}

func (e OrExpr) Eval(tags map[string]bool) bool {
	return e.Left.Eval(tags) || e.Right.Eval(tags)
}

// Parse logic
func (p *parser) Parse() Expr {
	if p.cur.Type == TokenEOF {
		return TagExpr{Tag: ""}
	}
	expr := p.parseOr()
	return expr
}

func (p *parser) parseOr() Expr {
	expr := p.parseAnd()
	for p.cur.Type == TokenOr {
		p.advance()
		right := p.parseAnd()
		if expr != nil && right != nil {
			expr = OrExpr{Left: expr, Right: right}
		}
	}
	return expr
}

func (p *parser) parseAnd() Expr {
	expr := p.parseUnary()
	for p.cur.Type == TokenAnd {
		p.advance()
		right := p.parseUnary()
		if expr != nil && right != nil {
			expr = AndExpr{Left: expr, Right: right}
		}
	}
	return expr
}

func (p *parser) parseUnary() Expr {
	if p.cur.Type == TokenNot {
		p.advance()
		expr := p.parsePrimary()
		if expr != nil {
			return NotExpr{Expr: expr}
		}
		return nil
	}
	return p.parsePrimary()
}

func (p *parser) parsePrimary() Expr {
	if p.cur.Type == TokenLParen {
		p.advance()
		expr := p.parseOr()
		if p.cur.Type == TokenRParen {
			p.advance()
		}
		return expr
	}

	if p.cur.Type == TokenTag {
		val := p.cur.Value
		p.advance()
		return TagExpr{Tag: val}
	}

	// Implicit missing operand
	p.advance()
	return nil
}

// EvaluateFilter evaluates a boolean expression against a list of assigned tags.
func EvaluateFilter(filter string, tags []string) bool {
	if strings.TrimSpace(filter) == "" {
		return false
	}
	
	tagMap := make(map[string]bool)
	for _, t := range tags {
		tagMap[strings.ToLower(strings.TrimSpace(t))] = true
	}

	p := newParser(filter)
	ast := p.Parse()
	if ast == nil {
		return false
	}
	return ast.Eval(tagMap)
}
