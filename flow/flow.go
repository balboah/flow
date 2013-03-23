package main

import (
	"log"
	"net/http"
	"joonix.se/flow"
)

const WwwRoot = "/Users/johnny/Documents/workspace/go/src/joonix.se/flow/html"

func main() {
	log.Println("Starting flow server")
	http.Handle("/echo", flow.EchoHandler())
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(WwwRoot)))

	err := http.ListenAndServe(":5000", nil)
    if err != nil {
        panic("ListenAndServe: " + err.Error())
    }
}