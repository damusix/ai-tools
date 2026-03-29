package aggregator

import (
	"testing"
)

func TestMergeTwoJSON(t *testing.T) {
	results := []ScriptOutput{
		{Stdout: []byte(`{"a":1}`), IsJSON: true},
		{Stdout: []byte(`{"b":2}`), IsJSON: true},
	}
	out := Aggregate(results)
	if out.JSON == nil {
		t.Fatal("expected merged JSON")
	}
	if out.JSON["a"] != float64(1) || out.JSON["b"] != float64(2) {
		t.Errorf("merged = %v, want a=1 b=2", out.JSON)
	}
}

func TestConcatenatePlainText(t *testing.T) {
	results := []ScriptOutput{
		{Stdout: []byte("warning one"), IsJSON: false},
		{Stdout: []byte("warning two"), IsJSON: false},
	}
	out := Aggregate(results)
	expected := "warning one\n———\nwarning two"
	if out.Text != expected {
		t.Errorf("text = %q, want %q", out.Text, expected)
	}
}

func TestMixedJSONAndText(t *testing.T) {
	results := []ScriptOutput{
		{Stdout: []byte(`{"a":1}`), IsJSON: true},
		{Stdout: []byte("watch out"), IsJSON: false},
	}
	out := Aggregate(results)
	if out.JSON == nil {
		t.Fatal("expected JSON part")
	}
	if out.Text != "watch out" {
		t.Errorf("text = %q, want %q", out.Text, "watch out")
	}
}

func TestLastWriterWins(t *testing.T) {
	results := []ScriptOutput{
		{Stdout: []byte(`{"key":"first"}`), IsJSON: true},
		{Stdout: []byte(`{"key":"second"}`), IsJSON: true},
	}
	out := Aggregate(results)
	if out.JSON["key"] != "second" {
		t.Errorf("key = %v, want second", out.JSON["key"])
	}
}

func TestSystemMessageConcat(t *testing.T) {
	results := []ScriptOutput{
		{Stdout: []byte(`{"systemMessage":"msg1"}`), IsJSON: true},
		{Stdout: []byte(`{"systemMessage":"msg2"}`), IsJSON: true},
	}
	out := Aggregate(results)
	expected := "msg1\n———\nmsg2"
	sm, _ := out.JSON["systemMessage"].(string)
	if sm != expected {
		t.Errorf("systemMessage = %q, want %q", sm, expected)
	}
}
