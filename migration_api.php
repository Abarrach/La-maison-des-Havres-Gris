<?php
header('Content-Type: application/json');

$file = 'migration_data.json';

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
    if (file_exists($file)) { echo file_get_contents($file); } 
    else { echo json_encode([]); }
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $input = json_decode(file_get_contents('php://input'), true);
    $data = file_exists($file) ? json_decode(file_get_contents($file), true) : [];
    
    $action = isset($input['action']) ? $input['action'] : 'save';

    if ($action === 'delete') {
        $deletedItem = null;
        foreach ($data as $item) {
            if (isset($item['id']) && $item['id'] === $input['id']) { $deletedItem = $item; }
        }
        
        $data = array_filter($data, function($item) use ($input) {
            return isset($item['id']) && $item['id'] !== $input['id'];
        });
        
        if ($deletedItem) {
            foreach ($data as &$item) {
                if (isset($item['coveredBy']) && strcasecmp($item['coveredBy'], $deletedItem['pseudo']) === 0) unset($item['coveredBy']);
                if (isset($item['covering']) && strcasecmp($item['covering'], $deletedItem['pseudo']) === 0) unset($item['covering']);
            }
        }
        $data = array_values($data);
    }
    elseif ($action === 'cover') { 
        $helper = trim($input['helper']);
        $helpee = trim($input['helpee']);
        
        $helpeeFound = false;

        // === SÉCURITÉ CÔTÉ SERVEUR ===
        // On vérifie si le Helper a déjà une base posée sur la carte.
        // Si oui, sa dispo DOIT être 'dispo_aide'. Sinon on bloque.
        foreach($data as $item) {
            if (strcasecmp($item['pseudo'], $helper) === 0) {
                if ($item['dispo'] !== 'dispo_aide') {
                    echo json_encode(["status" => "error", "message" => "Refusé par le serveur : Vous devez changer votre disponibilité en 'Présent ET j'ai de la place pour aider' avant d'offrir votre fief."]);
                    exit;
                }
            }
        }
        
        // On lie les deux joueurs
        foreach($data as &$item) {
            if (strcasecmp($item['pseudo'], $helpee) === 0) {
                $item['coveredBy'] = $helper;
                $helpeeFound = true;
            }
            if (strcasecmp($item['pseudo'], $helper) === 0) {
                $item['covering'] = $helpee;
            }
        }
        
        if (!$helpeeFound) {
            echo json_encode(["status" => "error", "message" => "Joueur introuvable."]);
            exit;
        }
    }
    elseif ($action === 'uncover') { 
        $helpee = trim($input['helpee']);
        $helper = null;
        foreach($data as &$item) {
            if (strcasecmp($item['pseudo'], $helpee) === 0) {
                $helper = isset($item['coveredBy']) ? $item['coveredBy'] : null;
                unset($item['coveredBy']);
            }
        }
        if ($helper) {
            foreach($data as &$item) {
                if (strcasecmp($item['pseudo'], $helper) === 0) unset($item['covering']);
            }
        }
    }
    else {
        $oldItem = null;
        foreach($data as $item) {
            if (strcasecmp($item['pseudo'], $input['pseudo']) === 0) $oldItem = $item;
        }
        
        if ($oldItem) {
            if (isset($oldItem['coveredBy'])) $input['coveredBy'] = $oldItem['coveredBy'];
            if (isset($oldItem['covering'])) $input['covering'] = $oldItem['covering'];
        }
        
        foreach($data as $item) {
            if (isset($item['coveredBy']) && strcasecmp($item['coveredBy'], $input['pseudo']) === 0) {
                $input['covering'] = $item['pseudo'];
            }
        }
        
        $data = array_filter($data, function($item) use ($input) { return strcasecmp($item['pseudo'], $input['pseudo']) !== 0; });
        
        $input['id'] = isset($oldItem['id']) ? $oldItem['id'] : uniqid();
        $data[] = $input;
        $data = array_values($data);
    }

    file_put_contents($file, json_encode($data, JSON_PRETTY_PRINT));
    echo json_encode(["status" => "success"]);
    exit;
}
?>