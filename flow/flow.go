package main

import (
	"log"
	"flag"
	"time"
	"net/http"
	"math/rand"
	"joonix.se/flow"
)

func main() {
	var root string
	flag.StringVar(&root,
		"www", "/Users/johnny/Documents/workspace/go/src/joonix.se/flow/html", "Web root to serve from")
	flag.Parse()

	rand.Seed(time.Now().UTC().UnixNano())
	log.Println("Starting flow server")
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(root)))

	err := http.ListenAndServe(":5000", nil)
    if err != nil {
        panic("ListenAndServe: " + err.Error())
    }
}