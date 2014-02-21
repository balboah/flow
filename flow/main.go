package main

import (
	"flag"
	"fmt"
	"github.com/balboah/flow"
	"log"
	"net/http"
)

var (
	root = flag.String("www", "html", "Web root to serve from")
	port = flag.Int("port", 5000, "Port to listen on")
)

func main() {
	flag.Parse()

	log.Printf("Starting flow server at %v\n", fmt.Sprintf(":%v", *port))
	http.Handle("/worms", flow.WormsHandler())
	http.Handle("/", http.FileServer(http.Dir(*root)))

	err := http.ListenAndServe(fmt.Sprintf(":%v", *port), nil)
	if err != nil {
		panic("ListenAndServe: " + err.Error())
	}
}
