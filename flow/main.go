package main

import (
	"flag"
	"fmt"
	"log"
	"net/http"

	"github.com/balboah/flow"
)

var (
	root = flag.String("www", "html", "Web root to serve from")
	port = flag.Int("port", 5000, "Port to listen on")
)

func main() {
	flag.Parse()

	addr := fmt.Sprintf(":%v", *port)
	log.Printf("Starting flow server at %v\n", addr)
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(*root)))

	if err := http.ListenAndServe(addr, nil); err != nil {
		log.Fatalf("ListenAndServe: %v", err)
	}
}
